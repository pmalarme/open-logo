// Unit tests for the conformance harness. Per ADR-0009, these are black-box tests that validate
// the harness behavior through its public interface (running fixtures). The wire format uses
// source_span (underscore) for diagnostics and source-span (hyphen) for events per ADR-0007.

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const TEMP_ROOT = "tests/conformance/_test-harness";

/** Clean up temp fixtures. */
function cleanup() {
  try {
    rmSync(TEMP_ROOT, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

/** Create a minimal test fixture and run the harness against it. */
function runHarness(fixtureName, logoSource, expected) {
  cleanup();
  mkdirSync(join(TEMP_ROOT, fixtureName), { recursive: true });
  writeFileSync(
    join(TEMP_ROOT, fixtureName, `${fixtureName}.logo`),
    logoSource,
  );
  writeFileSync(
    join(TEMP_ROOT, fixtureName, `${fixtureName}.expected.json`),
    JSON.stringify(expected, null, 2),
  );

  try {
    execSync("node scripts/conformance.mjs", { encoding: "utf8" });
    return { exitCode: 0 };
  } catch (err) {
    return { exitCode: err.status || 1, output: err.stdout + err.stderr };
  } finally {
    cleanup();
  }
}

test("harness preserves parser diagnostics source_span (underscore)", () => {
  // Parser emits diagnostics with source_span (underscore), which is the correct wire format
  // per ADR-0007 and tests/conformance/README.md. No conversion needed.
  const result = runHarness("wire-format-test", "]", {
    description:
      "Test that harness preserves source_span as underscore for diagnostics",
    profiles: ["core-language"],
    events: [],
    diagnostics: [
      {
        code: "ol-unmatched-bracket",
        source_span: {
          document: "conformance-fixture",
          start: [1, 1],
          end: [1, 2],
        },
        params: { delimiter: "]" },
        stage: "parse",
        severity: "error",
        message:
          "this ] doesn't have a matching bracket. lists and blocks need both [ and ].",
      },
    ],
  });

  assert.equal(
    result.exitCode,
    0,
    `Harness should preserve source_span as underscore; got:\n${result.output || "(no output)"}`,
  );
});

test("harness preserves nested params with underscores", () => {
  // Diagnostic params use underscored keys (source_span, opened_at) per the spec.
  const result = runHarness("params-test", '"unclosed', {
    description: "Test that harness preserves params keys with underscores",
    profiles: ["core-language"],
    events: [],
    diagnostics: [
      {
        code: "ol-unclosed-string",
        source_span: {
          document: "conformance-fixture",
          start: [1, 1],
          end: [1, 2],
        },
        params: {
          opened_at: {
            document: "conformance-fixture",
            start: [1, 1],
            end: [1, 2],
          },
        },
        stage: "parse",
        severity: "error",
        message:
          'this word is missing its closing ". every "word" needs a quote on both ends.',
      },
    ],
  });

  assert.equal(
    result.exitCode,
    0,
    `Harness should preserve params with underscores; got:\n${result.output || "(no output)"}`,
  );
});

test("harness detects mismatch when diagnostic differs", () => {
  const result = runHarness("mismatch-test", "]", {
    description: "Test that harness detects mismatch",
    profiles: ["core-language"],
    events: [],
    diagnostics: [
      {
        code: "ol-bad-token", // wrong code
        source_span: {
          document: "conformance-fixture",
          start: [1, 1],
          end: [1, 2],
        },
        params: { text: "]" },
        stage: "parse",
        severity: "error",
        message: "Wrong",
      },
    ],
  });

  assert.equal(
    result.exitCode,
    1,
    "Harness should detect mismatch and exit non-zero",
  );
});

test("harness validates diagnostic codes against registry", () => {
  const result = runHarness("invalid-code-test", "", {
    description: "Test that harness validates diagnostic codes",
    profiles: ["core-language"],
    events: [],
    diagnostics: [
      {
        code: "ol-not-a-real-code",
        source_span: {
          document: "conformance-fixture",
          start: [1, 1],
          end: [1, 1],
        },
        params: {},
        stage: "parse",
        severity: "error",
        message: "Fake",
      },
    ],
  });

  assert.equal(
    result.exitCode,
    1,
    "Harness should reject off-contract diagnostic code",
  );
  assert.match(
    result.output || "",
    /not in the @openlogo\/core registry/,
    "Error message should mention registry",
  );
});

test("harness validates event kinds against registry", () => {
  const result = runHarness("invalid-event-test", "", {
    description: "Test that harness validates event kinds",
    profiles: ["core-language"],
    events: [
      {
        seq: 1,
        kind: "not-a-real-event-kind",
        "source-span": {
          document: "conformance-fixture",
          start: [1, 1],
          end: [1, 1],
        },
        payload: {},
      },
    ],
    diagnostics: [],
  });

  assert.equal(
    result.exitCode,
    1,
    "Harness should reject off-contract event kind",
  );
  assert.match(
    result.output || "",
    /not in the @openlogo\/core registry/,
    "Error message should mention registry",
  );
});

test("harness validates profile names against known profiles", () => {
  const result = runHarness("invalid-profile-test", "", {
    description: "Test that harness validates profile names",
    profiles: ["not-a-real-profile"],
    events: [],
    diagnostics: [],
  });

  assert.equal(
    result.exitCode,
    1,
    "Harness should reject unknown profile name",
  );
  assert.match(
    result.output || "",
    /not a known OpenLogo profile/,
    "Error message should mention profile validation",
  );
});

test("harness reports invalid JSON in fixture", () => {
  cleanup();
  mkdirSync(join(TEMP_ROOT, "bad-json-test"), { recursive: true });
  writeFileSync(join(TEMP_ROOT, "bad-json-test", "bad-json-test.logo"), "");
  writeFileSync(
    join(TEMP_ROOT, "bad-json-test", "bad-json-test.expected.json"),
    "{invalid json}",
  );

  try {
    execSync("node scripts/conformance.mjs", { encoding: "utf8" });
    assert.fail("Harness should reject invalid JSON");
  } catch (err) {
    assert.equal(err.status, 1, "Should exit with code 1");
    assert.match(
      err.stdout + err.stderr,
      /invalid JSON/,
      "Error message should mention invalid JSON",
    );
  } finally {
    cleanup();
  }
});

test("harness supports --profile flag to select fixtures", () => {
  cleanup();
  mkdirSync(join(TEMP_ROOT, "profile-test"), { recursive: true });
  writeFileSync(join(TEMP_ROOT, "profile-test", "profile-test.logo"), "");
  writeFileSync(
    join(TEMP_ROOT, "profile-test", "profile-test.expected.json"),
    JSON.stringify(
      {
        description: "Test profile selection",
        profiles: ["turtle-rendering"],
        events: [],
        diagnostics: [],
      },
      null,
      2,
    ),
  );

  try {
    const output = execSync(
      "node scripts/conformance.mjs --profile core-language",
      { encoding: "utf8" },
    );
    assert.match(output, /skipped/, "Should report skipped fixtures");
  } finally {
    cleanup();
  }
});

test("harness rejects unknown profile name", () => {
  try {
    execSync("node scripts/conformance.mjs --profile not-a-real-profile", {
      encoding: "utf8",
    });
    assert.fail("Harness should reject unknown profile");
  } catch (err) {
    assert.equal(err.status, 2, "Should exit with code 2 for invalid args");
    assert.match(
      err.stdout + err.stderr,
      /unknown profile/,
      "Error message should mention unknown profile",
    );
  }
});

test("harness continues when one fixture exists", () => {
  const result = runHarness("single-test", "", {
    description: "Single test",
    profiles: ["core-language"],
    events: [],
    diagnostics: [],
  });

  assert.equal(result.exitCode, 0);
});

test("harness compares deep objects and arrays", () => {
  // Mismatched object - wrong nested value in source_span
  const result1 = runHarness("deep-obj-test", "]", {
    description: "Test deep object comparison",
    profiles: ["core-language"],
    events: [],
    diagnostics: [
      {
        code: "ol-unmatched-bracket",
        source_span: {
          document: "conformance-fixture",
          start: [1, 1],
          end: [99, 99], // wrong end position
        },
        params: { delimiter: "]" },
        stage: "parse",
        severity: "error",
        message:
          "this ] doesn't have a matching bracket. lists and blocks need both [ and ].",
      },
    ],
  });

  assert.equal(
    result1.exitCode,
    1,
    "Should detect deep object value mismatch in diagnostics",
  );
});

test("harness handles profiles with dependencies", () => {
  cleanup();
  mkdirSync(join(TEMP_ROOT, "profile-deps-test"), { recursive: true });
  writeFileSync(
    join(TEMP_ROOT, "profile-deps-test", "profile-deps-test.logo"),
    "",
  );
  writeFileSync(
    join(TEMP_ROOT, "profile-deps-test", "profile-deps-test.expected.json"),
    JSON.stringify(
      {
        description: "Test profile with dependencies",
        profiles: ["turtle-rendering"], // depends on core-language
        events: [],
        diagnostics: [],
      },
      null,
      2,
    ),
  );

  try {
    const output = execSync("node scripts/conformance.mjs", {
      encoding: "utf8",
    });
    assert.match(output, /passed/, "Should handle profile dependencies");
  } finally {
    cleanup();
  }
});
