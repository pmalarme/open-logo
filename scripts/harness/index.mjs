/**
 * Conformance harness logic module. Extracted per ADR-0009 to enable 100% test coverage via
 * direct imports, while keeping the CLI shell thin and subprocess-tested. See
 * docs/adr/0007-conformance-harness.md for the fixture contract.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, sep } from "node:path";
import {
  OL_DIAGNOSTIC_CODES,
  OL_EVENT_KINDS,
  OL_STYLE_DIAGNOSTIC_CODES,
} from "@openlogo/core";
import { check, parse } from "@openlogo/parser";
import { execute } from "@openlogo/runtime";

export const ROOT = "tests/conformance";
export const EXPECTED_SUFFIX = ".expected.json";

// Profile dependency closure from spec/conformance.md's DAG.
export const PROFILE_DEPS = {
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
export function closureOf(profile) {
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

/** Discover every `*.expected.json` fixture under tests/conformance/, sorted by path.
 * Validates that each .logo file has a .expected.json sibling and vice versa (no orphans).
 */
export function discoverFixtures(root = ROOT) {
  if (!existsSync(root)) {
    return [];
  }

  const expectedFiles = new Set();
  const logoFiles = new Set();

  // Scan directory for both file types
  for (const entry of readdirSync(root, { recursive: true }).map(String)) {
    if (entry.endsWith(EXPECTED_SUFFIX)) {
      expectedFiles.add(entry.slice(0, -EXPECTED_SUFFIX.length));
    } else if (entry.endsWith(".logo")) {
      logoFiles.add(entry.slice(0, -".logo".length));
    }
  }

  // Check for orphans
  const orphanExpected = [...expectedFiles].filter(
    (stem) => !logoFiles.has(stem),
  );
  const orphanLogo = [...logoFiles].filter((stem) => !expectedFiles.has(stem));

  if (orphanExpected.length > 0) {
    throw new Error(
      `Orphan .expected.json file(s) without .logo sibling:\n  ${orphanExpected.map((s) => s + EXPECTED_SUFFIX).join("\n  ")}`,
    );
  }
  if (orphanLogo.length > 0) {
    throw new Error(
      `Orphan .logo file(s) without .expected.json sibling:\n  ${orphanLogo.map((s) => `${s}.logo`).join("\n  ")}`,
    );
  }

  const fixtures = [];
  for (const stem of expectedFiles) {
    const entry = stem + EXPECTED_SUFFIX;
    const expectedPath = join(root, entry);
    fixtures.push({
      name: entry.split(sep).join("/"),
      expectedPath,
      logoPath: join(dirname(expectedPath), `${basename(stem)}.logo`),
    });
  }

  fixtures.sort((a, b) => a.name.localeCompare(b.name));
  return fixtures;
}

/** Parse and normalise a fixture; returns `{ error }` on malformed JSON or missing source. */
export function loadFixture(fixture) {
  // Validate that both .logo and .expected.json exist
  if (!existsSync(fixture.logoPath)) {
    return { error: `missing source file ${fixture.logoPath}` };
  }
  if (!existsSync(fixture.expectedPath)) {
    return { error: `missing expected file ${fixture.expectedPath}` };
  }

  let spec;
  try {
    spec = JSON.parse(readFileSync(fixture.expectedPath, "utf8"));
  } catch (err) {
    return { error: `invalid JSON: ${err.message}` };
  }
  // Validate fixture schema (per spec/error-model.md - reject malformed JSON)
  if (!Array.isArray(spec.profiles)) {
    return { error: `"profiles" must be an array` };
  }
  if (!Array.isArray(spec.events)) {
    return { error: `"events" must be an array` };
  }
  if (!Array.isArray(spec.diagnostics)) {
    return { error: `"diagnostics" must be an array` };
  }

  // Validate each diagnostic has required fields per spec/error-model.md:28-38
  // Note: "message" is optional per error-model.md:193-194 (diagnostic identity = code+params, not prose)
  for (let i = 0; i < spec.diagnostics.length; i++) {
    const diag = spec.diagnostics[i];
    if (!diag.code) {
      return { error: `diagnostic[${i}] missing required field "code"` };
    }
    if (!diag.source_span) {
      return { error: `diagnostic[${i}] missing required field "source_span"` };
    }
    if (!diag.params) {
      return { error: `diagnostic[${i}] missing required field "params"` };
    }
    if (!diag.stage) {
      return { error: `diagnostic[${i}] missing required field "stage"` };
    }
    if (!diag.severity) {
      return { error: `diagnostic[${i}] missing required field "severity"` };
    }
    // message is optional (prose, not identity)
  }

  // "execute" is an opt-in flag (default false): only fixtures that opt in get their AST
  // executed via @openlogo/runtime; every other fixture stays parse-only (per issue #90 — the
  // parse-focused corpus is not all execution-valid, so execution must never run by default).
  if (spec.execute !== undefined && typeof spec.execute !== "boolean") {
    return { error: `"execute" must be a boolean when present` };
  }

  // "check" is an opt-in flag (default false), mirroring "execute": only fixtures that opt in
  // get their AST run through @openlogo/parser's check() semantic checker (per issue #116);
  // every other fixture stays parse-only (or execute-only), since the parse-focused corpus is
  // not all semantic-check-valid.
  if (spec.check !== undefined && typeof spec.check !== "boolean") {
    return { error: `"check" must be a boolean when present` };
  }

  // "style" is an opt-in flag (default false), mirroring "check": only fixtures that opt in
  // (alongside "check": true) get check()'s Layer-3 style lints enabled via { style: true }
  // (per issue #115); every other check:true fixture stays Layer-2-only, since the existing
  // check corpus never opted into style warnings and must not regress when they are added.
  if (spec.style !== undefined && typeof spec.style !== "boolean") {
    return { error: `"style" must be a boolean when present` };
  }

  const expected = {
    description: spec.description ?? "",
    profiles: spec.profiles,
    expect: spec.expect ?? "match",
    execute: spec.execute ?? false,
    check: spec.check ?? false,
    style: spec.style ?? false,
    events: spec.events,
    diagnostics: spec.diagnostics,
  };

  // Validate expect field
  if (expected.expect !== "match" && expected.expect !== "mismatch") {
    return {
      error: `invalid expect field: "${expected.expect}" (must be "match" or "mismatch")`,
    };
  }

  const source = readFileSync(fixture.logoPath, "utf8");
  return { expected, source };
}

/** Static checks that a fixture references only registered profiles, event kinds, and codes. */
export function fixtureErrors(expected) {
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
 * Validate that diagnostics conform to the spec shape.
 * Per spec/error-model.md:28-38, every diagnostic must have a message field.
 * @param {Array} diagnostics - The diagnostics to validate.
 * @throws {Error} If any diagnostic is missing the message field.
 */
export function validateDiagnostics(diagnostics) {
  for (let i = 0; i < diagnostics.length; i++) {
    const diag = diagnostics[i];
    if (!diag.message) {
      throw new Error(
        `produce(): actual diagnostic[${i}] missing required "message" field (spec/error-model.md:28-38)`,
      );
    }
  }
}

/**
 * Parse (and, if opted in, execute or check) source and collect the output.
 *
 * When both `shouldExecute` and `shouldCheck` are false (the default), this is parse-only: it
 * calls the parser and collects parse diagnostics, returning an empty event stream — the
 * behavior every existing parse-focused fixture in the corpus relies on.
 *
 * When `shouldCheck` is true (a fixture opted in via `"check": true`), it calls `parse()` and,
 * if parsing produced no diagnostic, feeds the resulting AST to `@openlogo/parser`'s `check()`
 * (issue #116) along with the fixture's active `profiles` and, when `shouldStyle` also opted in
 * (`"style": true`, issue #115), `{ style: true }` to additionally enable the Layer-3 style
 * lints — returning the semantic/style diagnostics `check()` found (an empty list is a clean
 * pass). If parsing itself failed, the document is not check-valid, so the parse diagnostics are
 * returned unchanged and `check()` never runs — mirroring how `shouldExecute` already treats a
 * parse failure as terminal.
 *
 * Otherwise, when `shouldExecute` is true (a fixture opted in via `"execute": true`), it calls
 * `@openlogo/runtime`'s `execute()` instead, which parses internally and also returns the
 * trace/event stream produced by walking the AST.
 *
 * Wire shape: parse diagnostics, runtime events/diagnostics, and check() diagnostics all already
 * use `source_span` (underscore) — the one field-name convention this harness uses throughout,
 * for both events and diagnostics (see tests/conformance/README.md). There is no separate wire
 * conversion step.
 *
 * @param {string} source - The OpenLogo source code to parse (and, if opted in, execute/check).
 * @param {string} document - The document identifier (fixture path) for diagnostic source_span.
 * @param {boolean} shouldExecute - Whether this fixture opted into execution (default false).
 * @param {boolean} shouldCheck - Whether this fixture opted into semantic checking (default false).
 * @param {string[]} profiles - The fixture's active profile set, passed to check() (default []).
 * @param {boolean} shouldStyle - Whether this fixture opted into style lints too (default false).
 */
export function produce(
  source,
  document,
  shouldExecute = false,
  shouldCheck = false,
  profiles = [],
  shouldStyle = false,
) {
  if (shouldCheck) {
    const { ast: program, diagnostics: parseDiagnostics } = parse(
      source,
      document,
    );
    const diagnostics =
      parseDiagnostics.length > 0
        ? parseDiagnostics
        : check(program, { profiles, source, style: shouldStyle }).diagnostics;
    validateDiagnostics(diagnostics);
    return { events: [], diagnostics };
  }

  const { events, diagnostics } = shouldExecute
    ? execute(source, document)
    : { events: [], ...parse(source, document) };

  // Validate actual diagnostics conform to spec (spec/error-model.md:28-38 requires message).
  validateDiagnostics(diagnostics);

  return { events, diagnostics };
}

/** Order-insensitive structural equality for the plain JSON values in a fixture. */
export function deepEqual(a, b) {
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
export function diffStream(label, keyField, expected, actual) {
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
export function compare(expected, actual) {
  // Per spec/error-model.md:193-194, diagnostic identity = code+params, not prose.
  // Exclude "message" from comparison (prose may change under localization/rewording).
  const projectDiagnostic = (d) => ({
    code: d.code,
    source_span: d.source_span,
    params: d.params,
    stage: d.stage,
    severity: d.severity,
  });

  const reports = [
    diffStream("event", "seq", expected.events, actual.events),
    diffStream(
      "diagnostic",
      "code",
      expected.diagnostics.map(projectDiagnostic),
      actual.diagnostics.map(projectDiagnostic),
    ),
  ].filter((report) => report !== null);
  return { matched: reports.length === 0, report: reports.join("\n") };
}

/** Parse CLI arguments. */
export function parseArgs(argv) {
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

/**
 * Run the conformance harness with the given options. Returns exit code.
 * This is the main logic entry point; the CLI shell calls this.
 */
export function runHarness(options = {}) {
  const { profile: selectedProfile, root = ROOT } = options;

  // Validate selected profile
  if (selectedProfile) {
    if (!(selectedProfile in PROFILE_DEPS)) {
      console.error(
        `conformance: unknown profile "${selectedProfile}" (not in the spec DAG)`,
      );
      return 2;
    }
  }

  const fixtures = discoverFixtures(root);
  if (fixtures.length === 0) {
    console.log(
      `conformance: no fixtures found under ${root} — nothing to run.`,
    );
    return 0;
  }

  let passed = 0;
  let failed = 0;
  let skipped = 0;
  const failures = [];

  for (const fixture of fixtures) {
    const loaded = loadFixture(fixture);
    if (loaded.error) {
      failed++;
      failures.push(`FAIL ${fixture.name}\n  ${loaded.error}`);
      continue;
    }

    const { expected, source } = loaded;

    // Check off-contract violations
    const errors = fixtureErrors(expected);
    if (errors.length > 0) {
      failed++;
      failures.push(
        `FAIL ${fixture.name} (off-contract fixture)\n  ${errors.join("\n  ")}`,
      );
      continue;
    }

    // Identify self-tests early (before profile filtering) so they always run
    const isSelfTest = fixture.name.startsWith("_harness-selftest/");

    // Self-tests must declare expect: "mismatch"
    if (isSelfTest && expected.expect !== "mismatch") {
      failed++;
      failures.push(
        `FAIL ${fixture.name} (self-test must declare expect: "mismatch")`,
      );
      continue;
    }

    // Filter by profile if --profile was given (but always run self-tests)
    if (selectedProfile && !isSelfTest) {
      const closure = closureOf(selectedProfile);
      const isIncluded = expected.profiles.some((p) => closure.has(p));
      if (!isIncluded) {
        skipped++;
        continue;
      }
    }

    // Document name for parser = fixture path without .expected.json suffix
    const document = fixture.name.replace(/\.expected\.json$/, "");
    const result = compare(
      expected,
      produce(
        source,
        document,
        expected.execute,
        expected.check,
        expected.profiles,
        expected.style,
      ),
    );

    // Use expect field to determine comparison polarity
    const expectMatch = expected.expect === "match";
    const success = expectMatch ? result.matched : !result.matched;

    if (success) {
      passed++;
      if (isSelfTest) {
        console.log(
          `ok   ${fixture.name} — self-test: mismatch correctly detected`,
        );
        console.log(result.report);
      } else {
        console.log(`ok   ${fixture.name}`);
      }
    } else {
      failed++;
      if (expectMatch) {
        failures.push(`FAIL ${fixture.name}\n${result.report}`);
      } else {
        failures.push(
          `FAIL ${fixture.name} (expected mismatch but streams matched)`,
        );
      }
    }
  }

  if (failures.length > 0) {
    console.log("");
    for (const failure of failures) {
      console.log(failure);
    }
  }

  const scope = selectedProfile ? `profile "${selectedProfile}"` : "full DAG";
  console.log(
    `\nconformance: ${passed} passed, ${failed} failed, ${skipped} skipped (${scope})`,
  );

  return failed > 0 ? 1 : 0;
}
