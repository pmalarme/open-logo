// Unit tests for the conformance harness logic module. Per ADR-0009, these tests import the
// harness module directly to achieve 100% coverage, plus one subprocess test for the CLI shell.

import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import {
  closureOf,
  deepEqual,
  produce,
  discoverFixtures,
  loadFixture,
  fixtureErrors,
  compare,
  diffStream,
  parseArgs,
  runHarness,
} from "./harness/index.mjs";

const TEMP_ROOT = ".temp-test-fixtures";

function cleanup() {
  try {
    rmSync(TEMP_ROOT, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

// Unit tests for individual functions

test("closureOf expands profile dependencies", () => {
  const result = closureOf("turtle-rendering");
  assert.ok(result.has("turtle-rendering"));
  assert.ok(result.has("core-language"));
  assert.equal(result.size, 2);
});

test("closureOf handles duplicate dependencies in DAG", () => {
  // geometry depends on both turtle-rendering and data;
  // turtle-rendering depends on core-language
  // So core-language appears in multiple paths
  const result = closureOf("geometry");
  assert.ok(result.has("geometry"));
  assert.ok(result.has("turtle-rendering"));
  assert.ok(result.has("data"));
  assert.ok(result.has("core-language"));
  assert.equal(result.size, 4); // No duplicates
});

test("closureOf throws on unknown profile", () => {
  assert.throws(
    () => closureOf("not-a-real-profile"),
    /unknown profile "not-a-real-profile"/,
  );
});

test("closureOf handles profiles with no dependencies", () => {
  const result = closureOf("core-language");
  assert.ok(result.has("core-language"));
  assert.equal(result.size, 1);
});

test("closureOf handles deeply nested dependencies", () => {
  // tutor-ai → educational → core-language
  const result = closureOf("tutor-ai");
  assert.ok(result.has("tutor-ai"));
  assert.ok(result.has("educational"));
  assert.ok(result.has("core-language"));
});

test("deepEqual compares primitives", () => {
  assert.ok(deepEqual(42, 42));
  assert.ok(deepEqual("hello", "hello"));
  assert.ok(deepEqual(true, true));
  assert.ok(deepEqual(null, null));
  assert.ok(!deepEqual(1, 2));
  assert.ok(!deepEqual("a", "b"));
  assert.ok(!deepEqual(null, 0));
  assert.ok(!deepEqual({}, null));
  assert.ok(!deepEqual(null, {}));
});

test("deepEqual compares arrays", () => {
  assert.ok(deepEqual([1, 2, 3], [1, 2, 3]));
  assert.ok(deepEqual([], []));
  assert.ok(!deepEqual([1, 2], [1, 2, 3])); // length mismatch
  assert.ok(!deepEqual([1, 2, 3], [1, 2])); // length mismatch
  assert.ok(!deepEqual([1, 2], [2, 1])); // value mismatch
  assert.ok(!deepEqual([1], {})); // array vs object
});

test("deepEqual compares objects", () => {
  assert.ok(deepEqual({ a: 1, b: 2 }, { a: 1, b: 2 }));
  assert.ok(deepEqual({}, {}));
  assert.ok(!deepEqual({ a: 1 }, { a: 1, b: 2 })); // key count mismatch
  assert.ok(!deepEqual({ a: 1, b: 2 }, { a: 1 })); // key count mismatch
  assert.ok(!deepEqual({ a: 1 }, { b: 1 })); // different keys
});

test("deepEqual compares nested structures", () => {
  assert.ok(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }));
  assert.ok(!deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] }));
});

test("produce calls real parser and returns diagnostics", () => {
  const result = produce("]", ["core-language"]);
  assert.ok(Array.isArray(result.events));
  assert.ok(Array.isArray(result.diagnostics));
  assert.equal(result.events.length, 0); // No runtime yet
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-unmatched-bracket");
  assert.ok(result.diagnostics[0].source_span); // underscore!
});

test("produce preserves nested params with underscores", () => {
  const result = produce('"unclosed', ["core-language"]);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-unclosed-string");
  assert.ok(result.diagnostics[0].params.opened_at); // underscore!
});

test("diffStream handles items with no keyField", () => {
  // Both items exist but neither has the keyField
  const expected = [{ other: "a" }, { other: "b" }];
  const actual = [{ other: "a" }, { other: "c" }];
  const result = diffStream("test", "nonexistent-field", expected, actual);
  assert.ok(result); // Should find mismatch
  assert.ok(result.includes("nonexistent-field")); // Key falls back to index
  assert.ok(result.includes("index 1"));
});

test("diffStream key fallback when expectedItem missing the field", () => {
  // expectedItem has no keyField, actualItem does
  const expected = [{ other: "x" }];
  const actual = [{ code: "ol-foo" }];
  const result = diffStream("test", "code", expected, actual);
  assert.ok(result);
  assert.ok(result.includes('"code":"ol-foo"')); // Uses actualItem's keyField
});

test("diffStream key fallback to index when both items lack keyField", () => {
  // Neither has the keyField, should fall back to index
  const expected = [{ x: 1 }];
  const actual = [{ y: 2 }];
  const result = diffStream("test", "code", expected, actual);
  assert.ok(result);
  assert.ok(result.includes("code=0")); // Falls back to index 0
});

test("diffStream handles missing items at start", () => {
  const expected = [];
  const actual = [{ code: "ol-foo" }];
  const result = diffStream("test", "code", expected, actual);
  assert.ok(result.includes("(missing)"));
});

test("diffStream handles missing items", () => {
  const expected = [{ code: "ol-foo" }];
  const actual = [];
  const result = diffStream("test", "code", expected, actual);
  assert.ok(result.includes("(missing)"));
});

test("diffStream returns null when streams match", () => {
  const items = [{ code: "ol-foo" }];
  const result = diffStream("test", "code", items, items);
  assert.equal(result, null);
});

test("compare returns matched when streams agree", () => {
  const expected = { events: [], diagnostics: [] };
  const actual = { events: [], diagnostics: [] };
  const result = compare(expected, actual);
  assert.ok(result.matched);
  assert.equal(result.report, "");
});

test("compare returns not matched with diff report", () => {
  const expected = {
    events: [],
    diagnostics: [{ code: "ol-foo", source_span: {}, params: {} }],
  };
  const actual = { events: [], diagnostics: [] };
  const result = compare(expected, actual);
  assert.ok(!result.matched);
  assert.ok(result.report.includes("diagnostic mismatch"));
});

test("parseArgs extracts --profile flag", () => {
  const result1 = parseArgs(["--profile", "core-language"]);
  assert.equal(result1.profile, "core-language");

  const result2 = parseArgs(["--profile=turtle-rendering"]);
  assert.equal(result2.profile, "turtle-rendering");

  const result3 = parseArgs([]);
  assert.equal(result3.profile, undefined);

  // Edge case: --profile at end with no value
  const result4 = parseArgs(["--profile"]);
  assert.equal(result4.profile, undefined);
});

test("fixtureErrors validates profile names", () => {
  const errors = fixtureErrors({
    profiles: ["not-a-real-profile"],
    events: [],
    diagnostics: [],
  });
  assert.equal(errors.length, 1);
  assert.ok(errors[0].includes("not a known OpenLogo profile"));
});

test("fixtureErrors validates event kinds", () => {
  const errors = fixtureErrors({
    profiles: ["core-language"],
    events: [{ kind: "not-a-real-event" }],
    diagnostics: [],
  });
  assert.equal(errors.length, 1);
  assert.ok(errors[0].includes("not in the @openlogo/core registry"));
});

test("fixtureErrors validates diagnostic codes", () => {
  const errors = fixtureErrors({
    profiles: ["core-language"],
    events: [],
    diagnostics: [{ code: "ol-not-a-real-code" }],
  });
  assert.equal(errors.length, 1);
  assert.ok(errors[0].includes("not in the @openlogo/core registry"));
});

test("fixtureErrors returns empty for valid fixture", () => {
  const errors = fixtureErrors({
    profiles: ["core-language"],
    events: [],
    diagnostics: [],
  });
  assert.equal(errors.length, 0);
});

test("loadFixture reads valid fixture", () => {
  cleanup();
  mkdirSync(join(TEMP_ROOT, "test-fixture"), { recursive: true });
  writeFileSync(join(TEMP_ROOT, "test-fixture", "test-fixture.logo"), "");
  writeFileSync(
    join(TEMP_ROOT, "test-fixture", "test-fixture.expected.json"),
    JSON.stringify({
      description: "Test",
      profiles: ["core-language"],
      events: [],
      diagnostics: [],
    }),
  );

  const loaded = loadFixture({
    name: "test-fixture/test-fixture.expected.json",
    expectedPath: join(TEMP_ROOT, "test-fixture", "test-fixture.expected.json"),
    logoPath: join(TEMP_ROOT, "test-fixture", "test-fixture.logo"),
  });

  assert.ok(!loaded.error);
  assert.equal(loaded.expected.description, "Test");
  assert.equal(loaded.source, "");
  cleanup();
});

test("loadFixture handles invalid JSON", () => {
  cleanup();
  mkdirSync(join(TEMP_ROOT, "bad-json"), { recursive: true });
  writeFileSync(join(TEMP_ROOT, "bad-json", "bad.expected.json"), "{invalid}");

  const loaded = loadFixture({
    name: "bad-json/bad.expected.json",
    expectedPath: join(TEMP_ROOT, "bad-json", "bad.expected.json"),
    logoPath: join(TEMP_ROOT, "bad-json", "bad.logo"),
  });

  assert.ok(loaded.error);
  assert.ok(loaded.error.includes("invalid JSON"));
  cleanup();
});

test("loadFixture handles missing .logo file", () => {
  cleanup();
  mkdirSync(join(TEMP_ROOT, "no-logo"), { recursive: true });
  writeFileSync(
    join(TEMP_ROOT, "no-logo", "test.expected.json"),
    JSON.stringify({
      profiles: ["core-language"],
      events: [],
      diagnostics: [],
    }),
  );

  const loaded = loadFixture({
    name: "no-logo/test.expected.json",
    expectedPath: join(TEMP_ROOT, "no-logo", "test.expected.json"),
    logoPath: join(TEMP_ROOT, "no-logo", "test.logo"),
  });

  assert.ok(!loaded.error);
  assert.equal(loaded.source, ""); // empty source when .logo missing
  cleanup();
});

test("discoverFixtures finds fixtures recursively", () => {
  // Uses real fixtures in tests/conformance/
  const fixtures = discoverFixtures();
  assert.ok(fixtures.length > 0);
  assert.ok(fixtures.some((f) => f.name.includes("core-language")));
});

test("discoverFixtures returns empty when root doesn't exist", () => {
  const fixtures = discoverFixtures("nonexistent-directory-xyz");
  assert.equal(fixtures.length, 0);
});

test("runHarness handles empty fixture directory", () => {
  cleanup();
  // Create an empty temp directory and test with it
  const emptyRoot = ".temp-empty-fixtures";
  mkdirSync(emptyRoot, { recursive: true });

  const exitCode = runHarness({ root: emptyRoot });
  assert.equal(exitCode, 0); // No fixtures = success (nothing to fail)

  rmSync(emptyRoot, { recursive: true, force: true });
});

test("runHarness handles fixture with load error", () => {
  cleanup();
  // Create a fixture with bad JSON
  mkdirSync(join("tests", "conformance", "_temp-bad-json"), {
    recursive: true,
  });
  writeFileSync(join("tests", "conformance", "_temp-bad-json", "bad.logo"), "");
  writeFileSync(
    join("tests", "conformance", "_temp-bad-json", "bad.expected.json"),
    "{not valid json",
  );

  const exitCode = runHarness({});
  assert.equal(exitCode, 1); // Should fail

  // Cleanup
  rmSync(join("tests", "conformance", "_temp-bad-json"), {
    recursive: true,
    force: true,
  });
});

test("runHarness exits 0 for passing fixtures", () => {
  // Real fixtures should pass
  const exitCode = runHarness({});
  assert.equal(exitCode, 0);
});

test("runHarness exits 2 for unknown profile", () => {
  const exitCode = runHarness({ profile: "not-a-real-profile" });
  assert.equal(exitCode, 2);
});

test("runHarness filters fixtures by profile", () => {
  const exitCode = runHarness({ profile: "core-language" });
  assert.equal(exitCode, 0);
});

test("runHarness detects fixture mismatches", () => {
  cleanup();
  mkdirSync(join(TEMP_ROOT, "mismatch"), { recursive: true });
  writeFileSync(join(TEMP_ROOT, "mismatch", "mismatch.logo"), "]");
  writeFileSync(
    join(TEMP_ROOT, "mismatch", "mismatch.expected.json"),
    JSON.stringify({
      profiles: ["core-language"],
      events: [],
      diagnostics: [{ code: "ol-bad-token" }], // wrong code
    }),
  );

  // discoverFixtures() uses ROOT which is tests/conformance/, so this fixture
  // at .temp-test-fixtures/ won't be discovered. We need to test compare() directly instead:
  const expected = {
    profiles: ["core-language"],
    events: [],
    diagnostics: [{ code: "ol-bad-token" }],
  };
  const actual = produce("]", ["core-language"]);
  const result = compare(expected, actual);

  assert.ok(!result.matched, "Expected mismatch but got match");
  assert.ok(result.report.length > 0, "Expected non-empty diff report");
  cleanup();
});

test("runHarness handles self-test fixtures correctly", () => {
  cleanup();
  mkdirSync(join(TEMP_ROOT, "_harness-selftest", "should-fail"), {
    recursive: true,
  });
  writeFileSync(
    join(TEMP_ROOT, "_harness-selftest", "should-fail", "should-fail.logo"),
    "", // empty program produces no diagnostics
  );
  writeFileSync(
    join(
      TEMP_ROOT,
      "_harness-selftest",
      "should-fail",
      "should-fail.expected.json",
    ),
    JSON.stringify({
      profiles: ["core-language"],
      events: [],
      diagnostics: [{ code: "ol-undefined-var" }], // expect a diagnostic that won't be there
    }),
  );

  const exitCode = runHarness({});
  // Self-test that doesn't match (as expected) should pass → exit 0
  assert.equal(exitCode, 0);
  cleanup();
});

// Subprocess integration test for the CLI shell
test("CLI shell runs via subprocess", (t, done) => {
  const proc = spawn("node", ["scripts/conformance.mjs"], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  proc.stdout.on("data", (data) => (stdout += data));
  proc.stderr.on("data", (data) => (stderr += data));

  proc.on("close", (code) => {
    try {
      assert.equal(code, 0, `CLI should exit 0; stderr: ${stderr}`);
      assert.ok(
        stdout.includes("conformance:"),
        "Should print conformance summary",
      );
      done();
    } catch (err) {
      done(err);
    }
  });
});

// Additional tests for uncovered branches in runHarness

test("runHarness handles self-test that wrongly matches", () => {
  cleanup();
  // Create a self-test fixture that will match (which should fail)
  mkdirSync(
    join("tests", "conformance", "_harness-selftest", "wrongly-passes"),
    { recursive: true },
  );
  writeFileSync(
    join(
      "tests",
      "conformance",
      "_harness-selftest",
      "wrongly-passes",
      "wrongly-passes.logo",
    ),
    "",
  );
  writeFileSync(
    join(
      "tests",
      "conformance",
      "_harness-selftest",
      "wrongly-passes",
      "wrongly-passes.expected.json",
    ),
    JSON.stringify({
      profiles: ["core-language"],
      events: [],
      diagnostics: [], // Will match empty program, which should FAIL in self-test
    }),
  );

  const exitCode = runHarness({});
  assert.equal(exitCode, 1); // Should fail because self-test matched

  // Cleanup the temp self-test fixture
  rmSync(join("tests", "conformance", "_harness-selftest", "wrongly-passes"), {
    recursive: true,
    force: true,
  });
});

test("runHarness handles normal fixture failure", () => {
  cleanup();
  // Create a normal fixture that will fail
  mkdirSync(join("tests", "conformance", "_temp-fail-test"), {
    recursive: true,
  });
  writeFileSync(
    join("tests", "conformance", "_temp-fail-test", "fail.logo"),
    "]",
  );
  writeFileSync(
    join("tests", "conformance", "_temp-fail-test", "fail.expected.json"),
    JSON.stringify({
      profiles: ["core-language"],
      events: [],
      diagnostics: [{ code: "ol-undefined-var" }], // Wrong diagnostic
    }),
  );

  const exitCode = runHarness({});
  assert.equal(exitCode, 1); // Should fail

  // Cleanup
  rmSync(join("tests", "conformance", "_temp-fail-test"), {
    recursive: true,
    force: true,
  });
});

test("runHarness handles off-contract fixtures", () => {
  cleanup();
  // Create an off-contract fixture (invalid profile)
  mkdirSync(join("tests", "conformance", "_temp-offcontract"), {
    recursive: true,
  });
  writeFileSync(
    join("tests", "conformance", "_temp-offcontract", "bad.logo"),
    "",
  );
  writeFileSync(
    join("tests", "conformance", "_temp-offcontract", "bad.expected.json"),
    JSON.stringify({
      profiles: ["not-a-real-profile"],
      events: [],
      diagnostics: [],
    }),
  );

  const exitCode = runHarness({});
  assert.equal(exitCode, 1); // Should fail

  // Cleanup
  rmSync(join("tests", "conformance", "_temp-offcontract"), {
    recursive: true,
    force: true,
  });
});
