// Unit tests for the conformance harness wire-format conversion. Per ADR-0009, these are
// black-box tests that validate the harness behavior through its public interface (running
// fixtures). We don't test the private conversion function directly; instead we create minimal
// fixtures and verify the harness correctly converts parser output to wire format.

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
  writeFileSync(join(TEMP_ROOT, fixtureName, `${fixtureName}.logo`), logoSource);
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

test("harness converts parser diagnostics from source_span to source-span", () => {
  // Parser emits diagnostics with source_span (underscore); wire format needs source-span (hyphen).
  // Use a source that triggers a parse diagnostic.
  const result = runHarness(
    "wire-format-test",
    "]",  // unmatched bracket
    {
      description: "Test that harness converts source_span to source-span",
      profiles: ["core-language"],
      events: [],
      diagnostics: [
        {
          code: "ol-unmatched-bracket",
          "source-span": {
            document: "conformance-fixture",
            start: [1, 1],
            end: [1, 2],
          },
          params: { delimiter: "]" },
          stage: "parse",
          severity: "error",
          message: "this ] doesn't have a matching bracket. lists and blocks need both [ and ].",
        },
      ],
    },
  );

  // If the harness correctly converts, the fixture should match and exit 0
  assert.equal(
    result.exitCode,
    0,
    `Harness should convert source_span to source-span and match; got:\n${result.output || "(no output)"}`,
  );
});

test("harness converts nested params from snake_case to kebab-case", () => {
  // Some diagnostics have params with underscored keys that need conversion.
  // The ol-unclosed-string diagnostic has an opened_at param.
  const result = runHarness(
    "params-conversion-test",
    '"unclosed',  // unclosed string
    {
      description: "Test that harness converts params keys from snake_case to kebab-case",
      profiles: ["core-language"],
      events: [],
      diagnostics: [
        {
          code: "ol-unclosed-string",
          "source-span": {
            document: "conformance-fixture",
            start: [1, 1],
            end: [1, 2],
          },
          params: {
            "opened-at": {
              document: "conformance-fixture",
              start: [1, 1],
              end: [1, 2],
            },
          },
          stage: "parse",
          severity: "error",
          message: 'this word is missing its closing ". every "word" needs a quote on both ends.',
        },
      ],
    },
  );

  assert.equal(
    result.exitCode,
    0,
    `Harness should convert params keys to kebab-case and match; got:\n${result.output || "(no output)"}`,
  );
});

test("harness detects mismatch when diagnostic differs", () => {
  // Verify that if the expected diagnostic doesn't match, the harness exits non-zero.
  const result = runHarness(
    "mismatch-test",
    "]",  // unmatched bracket
    {
      description: "Test that harness detects mismatch",
      profiles: ["core-language"],
      events: [],
      diagnostics: [
        {
          code: "ol-bad-token",  // wrong code - parser emits ol-unmatched-bracket
          "source-span": {
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
    },
  );

  assert.equal(
    result.exitCode,
    1,
    "Harness should detect mismatch and exit non-zero",
  );
});

test("harness validates diagnostic codes against registry", () => {
  // A fixture with an off-contract diagnostic code should fail validation.
  const result = runHarness(
    "invalid-code-test",
    "",  // empty program
    {
      description: "Test that harness validates diagnostic codes",
      profiles: ["core-language"],
      events: [],
      diagnostics: [
        {
          code: "ol-not-a-real-code",
          "source-span": {
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
    },
  );

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
  // A fixture with an off-contract event kind should fail validation.
  const result = runHarness(
    "invalid-event-test",
    "",  // empty program
    {
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
    },
  );

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
  // A fixture with an unknown profile should fail validation.
  const result = runHarness(
    "invalid-profile-test",
    "",  // empty program
    {
      description: "Test that harness validates profile names",
      profiles: ["not-a-real-profile"],
      events: [],
      diagnostics: [],
    },
  );

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
  // A fixture with malformed JSON should fail gracefully.
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
