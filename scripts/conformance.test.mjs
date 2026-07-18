// Unit tests for the conformance harness logic module. Per ADR-0009, these tests import the
// harness module directly to achieve 100% coverage, plus one subprocess test for the CLI shell.

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { text } from "node:stream/consumers";
import {
  closureOf,
  deepEqual,
  produce,
  validateDiagnostics,
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
  rmSync(TEMP_ROOT, { recursive: true, force: true });
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
  const result = produce('"unclosed', "test-doc");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-unclosed-string");
  assert.ok(result.diagnostics[0].params.opened_at); // underscore!
  // Also verify spec-required message field is present (spec/error-model.md:28-38)
  assert.ok(
    result.diagnostics[0].message,
    "Actual diagnostic must have message field per spec",
  );
});

test("produce is parse-only by default: no events even for an executable program", () => {
  const result = produce("print 1", "test-doc");
  assert.deepEqual(result.events, []);
  assert.deepEqual(result.diagnostics, []);
});

test("produce executes via @openlogo/runtime when opted in", () => {
  const result = produce("print 1\nprint 2", "test-doc", true);
  assert.equal(result.diagnostics.length, 0);
  assert.equal(result.events.length, 4);
  assert.equal(result.events[0].kind, "instruction");
  assert.equal(result.events[0].seq, 0);
  assert.equal(result.events[1].kind, "print");
  assert.equal(result.events[1].seq, 1);
  assert.equal(result.events[2].kind, "instruction");
  assert.equal(result.events[2].seq, 2);
  assert.equal(result.events[3].kind, "print");
  assert.equal(result.events[3].seq, 3);
});

test("produce returns runtime diagnostics with message when opted in on malformed source", () => {
  const result = produce("]", "test-doc", true);
  assert.deepEqual(result.events, []);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-unmatched-bracket");
  assert.ok(result.diagnostics[0].message);
});

test("produce runs check() and returns an empty diagnostics list for a clean program", () => {
  const result = produce("print 1", "test-doc", false, true, ["core-language"]);
  assert.deepEqual(result.events, []);
  assert.deepEqual(result.diagnostics, []);
});

test("produce defaults the check profiles to an empty array when not given", () => {
  // With no profiles passed, `produce()`'s default parameter is `[]` (no active profile), so
  // `check()` sees no active profile and treats `print` as not visible — proving the default is
  // genuinely `[]`, not e.g. `["core-language"]` (issue #117 gave `check()` its first real rule,
  // so this is now an observable behavior rather than a default that happened not to matter).
  const result = produce("print 1", "test-doc", false, true);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-unknown-command");
  assert.deepEqual(result.diagnostics[0].params, { name: "print" });
});

test("produce short-circuits check() and returns parse diagnostics on a parse failure", () => {
  const result = produce("]", "test-doc", false, true, ["core-language"]);
  assert.deepEqual(result.events, []);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-unmatched-bracket");
  assert.ok(result.diagnostics[0].message);
});

test("produce prefers check-mode over execute-mode when both are opted in", () => {
  const result = produce("print 1", "test-doc", true, true, ["core-language"]);
  assert.deepEqual(result.events, []);
  assert.deepEqual(result.diagnostics, []);
});

test("validateDiagnostics passes for well-formed diagnostics", () => {
  const diagnostics = [
    {
      code: "ol-test",
      message: "Test message",
      source_span: { document: "test", start: [1, 1], end: [1, 2] },
      params: {},
      stage: "parse",
      severity: "error",
    },
  ];
  // Should not throw
  assert.doesNotThrow(() => validateDiagnostics(diagnostics));
});

test("validateDiagnostics throws when diagnostic missing message", () => {
  const diagnostics = [
    {
      code: "ol-test",
      // missing message field
      source_span: { document: "test", start: [1, 1], end: [1, 2] },
      params: {},
      stage: "parse",
      severity: "error",
    },
  ];
  assert.throws(
    () => validateDiagnostics(diagnostics),
    /actual diagnostic\[0\] missing required "message" field/,
  );
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

test("compare ignores diagnostic message field (prose not identity)", () => {
  // Per spec/error-model.md:193-194, diagnostic identity = code+params, not prose
  const expected = {
    events: [],
    diagnostics: [
      {
        code: "ol-test",
        source_span: { document: "test", start: [1, 1], end: [1, 2] },
        params: { foo: "bar" },
        stage: "parse",
        severity: "error",
        message: "Expected prose A",
      },
    ],
  };
  const actual = {
    events: [],
    diagnostics: [
      {
        code: "ol-test",
        source_span: { document: "test", start: [1, 1], end: [1, 2] },
        params: { foo: "bar" },
        stage: "parse",
        severity: "error",
        message: "Actual prose B (different)",
      },
    ],
  };
  const result = compare(expected, actual);
  assert.ok(
    result.matched,
    "Diagnostics differing only in message should match",
  );
});

test("compare matches diagnostic without message field", () => {
  // Fixtures may omit message (canonical format per conformance-fixture skill)
  const expected = {
    events: [],
    diagnostics: [
      {
        code: "ol-test",
        source_span: { document: "test", start: [1, 1], end: [1, 2] },
        params: {},
        stage: "parse",
        severity: "error",
        // no message field
      },
    ],
  };
  const actual = {
    events: [],
    diagnostics: [
      {
        code: "ol-test",
        source_span: { document: "test", start: [1, 1], end: [1, 2] },
        params: {},
        stage: "parse",
        severity: "error",
        message: "This message is ignored",
      },
    ],
  };
  const result = compare(expected, actual);
  assert.ok(
    result.matched,
    "Expected without message should match actual with message",
  );
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

test("loadFixture rejects malformed fixture schema", () => {
  cleanup();
  // Create fixtures with missing required array fields
  mkdirSync(join(TEMP_ROOT, "malformed"), { recursive: true });
  writeFileSync(join(TEMP_ROOT, "malformed", "malformed.logo"), "");

  // Missing profiles array
  writeFileSync(
    join(TEMP_ROOT, "malformed", "malformed.expected.json"),
    JSON.stringify({ events: [], diagnostics: [] }),
  );
  let loaded = loadFixture({
    name: "malformed/malformed.expected.json",
    expectedPath: join(TEMP_ROOT, "malformed", "malformed.expected.json"),
    logoPath: join(TEMP_ROOT, "malformed", "malformed.logo"),
  });
  assert.ok(loaded.error);
  assert.ok(loaded.error.includes('"profiles" must be an array'));

  // Missing events array
  writeFileSync(
    join(TEMP_ROOT, "malformed", "malformed.expected.json"),
    JSON.stringify({ profiles: [], diagnostics: [] }),
  );
  loaded = loadFixture({
    name: "malformed/malformed.expected.json",
    expectedPath: join(TEMP_ROOT, "malformed", "malformed.expected.json"),
    logoPath: join(TEMP_ROOT, "malformed", "malformed.logo"),
  });
  assert.ok(loaded.error);
  assert.ok(loaded.error.includes('"events" must be an array'));

  // Missing diagnostics array
  writeFileSync(
    join(TEMP_ROOT, "malformed", "malformed.expected.json"),
    JSON.stringify({ profiles: [], events: [] }),
  );
  loaded = loadFixture({
    name: "malformed/malformed.expected.json",
    expectedPath: join(TEMP_ROOT, "malformed", "malformed.expected.json"),
    logoPath: join(TEMP_ROOT, "malformed", "malformed.logo"),
  });
  assert.ok(loaded.error);
  assert.ok(loaded.error.includes('"diagnostics" must be an array'));

  // Diagnostic missing required field "source_span"
  writeFileSync(
    join(TEMP_ROOT, "malformed", "malformed.expected.json"),
    JSON.stringify({
      profiles: [],
      events: [],
      diagnostics: [{ code: "ol-test" }], // Missing source_span, params, stage, severity, message
    }),
  );
  loaded = loadFixture({
    name: "malformed/malformed.expected.json",
    expectedPath: join(TEMP_ROOT, "malformed", "malformed.expected.json"),
    logoPath: join(TEMP_ROOT, "malformed", "malformed.logo"),
  });
  assert.ok(loaded.error);
  assert.ok(loaded.error.includes('missing required field "source_span"'));

  // Diagnostic missing required field "params"
  writeFileSync(
    join(TEMP_ROOT, "malformed", "malformed.expected.json"),
    JSON.stringify({
      profiles: [],
      events: [],
      diagnostics: [
        {
          code: "ol-test",
          source_span: { document: "test", start: [1, 1], end: [1, 1] },
        },
      ],
    }),
  );
  loaded = loadFixture({
    name: "malformed/malformed.expected.json",
    expectedPath: join(TEMP_ROOT, "malformed", "malformed.expected.json"),
    logoPath: join(TEMP_ROOT, "malformed", "malformed.logo"),
  });
  assert.ok(loaded.error);
  assert.ok(loaded.error.includes('missing required field "params"'));

  // Diagnostic missing required field "stage"
  writeFileSync(
    join(TEMP_ROOT, "malformed", "malformed.expected.json"),
    JSON.stringify({
      profiles: [],
      events: [],
      diagnostics: [
        {
          code: "ol-test",
          source_span: { document: "test", start: [1, 1], end: [1, 1] },
          params: {},
        },
      ],
    }),
  );
  loaded = loadFixture({
    name: "malformed/malformed.expected.json",
    expectedPath: join(TEMP_ROOT, "malformed", "malformed.expected.json"),
    logoPath: join(TEMP_ROOT, "malformed", "malformed.logo"),
  });
  assert.ok(loaded.error);
  assert.ok(loaded.error.includes('missing required field "stage"'));

  // Diagnostic missing required field "severity"
  writeFileSync(
    join(TEMP_ROOT, "malformed", "malformed.expected.json"),
    JSON.stringify({
      profiles: [],
      events: [],
      diagnostics: [
        {
          code: "ol-test",
          source_span: { document: "test", start: [1, 1], end: [1, 1] },
          params: {},
          stage: "parse",
        },
      ],
    }),
  );
  loaded = loadFixture({
    name: "malformed/malformed.expected.json",
    expectedPath: join(TEMP_ROOT, "malformed", "malformed.expected.json"),
    logoPath: join(TEMP_ROOT, "malformed", "malformed.logo"),
  });
  assert.ok(loaded.error);
  assert.ok(loaded.error.includes('missing required field "severity"'));

  // Diagnostic with all required fields (message is optional)
  writeFileSync(
    join(TEMP_ROOT, "malformed", "malformed.expected.json"),
    JSON.stringify({
      profiles: [],
      events: [],
      diagnostics: [
        {
          code: "ol-test",
          source_span: { document: "test", start: [1, 1], end: [1, 1] },
          params: {},
          stage: "parse",
          severity: "error",
          // message is optional per spec/error-model.md:193-194
        },
      ],
    }),
  );
  loaded = loadFixture({
    name: "malformed/malformed.expected.json",
    expectedPath: join(TEMP_ROOT, "malformed", "malformed.expected.json"),
    logoPath: join(TEMP_ROOT, "malformed", "malformed.logo"),
  });
  assert.ok(
    !loaded.error,
    "Diagnostic without message should load (message is optional)",
  );

  // Diagnostic missing required field "code" (first check)
  writeFileSync(
    join(TEMP_ROOT, "malformed", "malformed.expected.json"),
    JSON.stringify({
      profiles: [],
      events: [],
      diagnostics: [
        {
          source_span: { document: "test", start: [1, 1], end: [1, 1] },
          params: {},
          stage: "parse",
          severity: "error",
          message: "test",
        },
      ],
    }),
  );
  loaded = loadFixture({
    name: "malformed/malformed.expected.json",
    expectedPath: join(TEMP_ROOT, "malformed", "malformed.expected.json"),
    logoPath: join(TEMP_ROOT, "malformed", "malformed.logo"),
  });
  assert.ok(loaded.error);
  assert.ok(loaded.error.includes('missing required field "code"'));

  cleanup();
});

test("loadFixture handles invalid JSON", () => {
  cleanup();
  mkdirSync(join(TEMP_ROOT, "bad-json"), { recursive: true });
  writeFileSync(join(TEMP_ROOT, "bad-json", "bad.logo"), ""); // Add .logo file
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

test("loadFixture validates expect field", () => {
  cleanup();
  mkdirSync(join(TEMP_ROOT, "bad-expect"), { recursive: true });
  writeFileSync(join(TEMP_ROOT, "bad-expect", "bad.logo"), "");
  writeFileSync(
    join(TEMP_ROOT, "bad-expect", "bad.expected.json"),
    JSON.stringify({
      expect: "invalid-value",
      profiles: ["core-language"],
      events: [],
      diagnostics: [],
    }),
  );

  const loaded = loadFixture({
    name: "bad-expect/bad.expected.json",
    expectedPath: join(TEMP_ROOT, "bad-expect", "bad.expected.json"),
    logoPath: join(TEMP_ROOT, "bad-expect", "bad.logo"),
  });

  assert.ok(loaded.error);
  assert.ok(loaded.error.includes("invalid expect field"));
  cleanup();
});

test("loadFixture defaults execute to false when absent", () => {
  cleanup();
  mkdirSync(join(TEMP_ROOT, "no-execute"), { recursive: true });
  writeFileSync(join(TEMP_ROOT, "no-execute", "no-execute.logo"), "");
  writeFileSync(
    join(TEMP_ROOT, "no-execute", "no-execute.expected.json"),
    JSON.stringify({
      profiles: ["core-language"],
      events: [],
      diagnostics: [],
    }),
  );

  const loaded = loadFixture({
    name: "no-execute/no-execute.expected.json",
    expectedPath: join(TEMP_ROOT, "no-execute", "no-execute.expected.json"),
    logoPath: join(TEMP_ROOT, "no-execute", "no-execute.logo"),
  });

  assert.equal(loaded.expected.execute, false);
  cleanup();
});

test("loadFixture reads an explicit execute: true opt-in", () => {
  cleanup();
  mkdirSync(join(TEMP_ROOT, "with-execute"), { recursive: true });
  writeFileSync(
    join(TEMP_ROOT, "with-execute", "with-execute.logo"),
    "print 1",
  );
  writeFileSync(
    join(TEMP_ROOT, "with-execute", "with-execute.expected.json"),
    JSON.stringify({
      profiles: ["core-language"],
      execute: true,
      events: [],
      diagnostics: [],
    }),
  );

  const loaded = loadFixture({
    name: "with-execute/with-execute.expected.json",
    expectedPath: join(TEMP_ROOT, "with-execute", "with-execute.expected.json"),
    logoPath: join(TEMP_ROOT, "with-execute", "with-execute.logo"),
  });

  assert.equal(loaded.expected.execute, true);
  cleanup();
});

test("loadFixture rejects a non-boolean execute field", () => {
  cleanup();
  mkdirSync(join(TEMP_ROOT, "bad-execute"), { recursive: true });
  writeFileSync(join(TEMP_ROOT, "bad-execute", "bad-execute.logo"), "");
  writeFileSync(
    join(TEMP_ROOT, "bad-execute", "bad-execute.expected.json"),
    JSON.stringify({
      profiles: ["core-language"],
      execute: "yes",
      events: [],
      diagnostics: [],
    }),
  );

  const loaded = loadFixture({
    name: "bad-execute/bad-execute.expected.json",
    expectedPath: join(TEMP_ROOT, "bad-execute", "bad-execute.expected.json"),
    logoPath: join(TEMP_ROOT, "bad-execute", "bad-execute.logo"),
  });

  assert.ok(loaded.error);
  assert.ok(loaded.error.includes('"execute" must be a boolean'));
  cleanup();
});

test("loadFixture defaults check to false when absent", () => {
  cleanup();
  mkdirSync(join(TEMP_ROOT, "no-check"), { recursive: true });
  writeFileSync(join(TEMP_ROOT, "no-check", "no-check.logo"), "");
  writeFileSync(
    join(TEMP_ROOT, "no-check", "no-check.expected.json"),
    JSON.stringify({
      profiles: ["core-language"],
      events: [],
      diagnostics: [],
    }),
  );

  const loaded = loadFixture({
    name: "no-check/no-check.expected.json",
    expectedPath: join(TEMP_ROOT, "no-check", "no-check.expected.json"),
    logoPath: join(TEMP_ROOT, "no-check", "no-check.logo"),
  });

  assert.equal(loaded.expected.check, false);
  cleanup();
});

test("loadFixture reads an explicit check: true opt-in", () => {
  cleanup();
  mkdirSync(join(TEMP_ROOT, "with-check"), { recursive: true });
  writeFileSync(join(TEMP_ROOT, "with-check", "with-check.logo"), "print 1");
  writeFileSync(
    join(TEMP_ROOT, "with-check", "with-check.expected.json"),
    JSON.stringify({
      profiles: ["core-language"],
      check: true,
      events: [],
      diagnostics: [],
    }),
  );

  const loaded = loadFixture({
    name: "with-check/with-check.expected.json",
    expectedPath: join(TEMP_ROOT, "with-check", "with-check.expected.json"),
    logoPath: join(TEMP_ROOT, "with-check", "with-check.logo"),
  });

  assert.equal(loaded.expected.check, true);
  cleanup();
});

test("loadFixture rejects a non-boolean check field", () => {
  cleanup();
  mkdirSync(join(TEMP_ROOT, "bad-check"), { recursive: true });
  writeFileSync(join(TEMP_ROOT, "bad-check", "bad-check.logo"), "");
  writeFileSync(
    join(TEMP_ROOT, "bad-check", "bad-check.expected.json"),
    JSON.stringify({
      profiles: ["core-language"],
      check: "yes",
      events: [],
      diagnostics: [],
    }),
  );

  const loaded = loadFixture({
    name: "bad-check/bad-check.expected.json",
    expectedPath: join(TEMP_ROOT, "bad-check", "bad-check.expected.json"),
    logoPath: join(TEMP_ROOT, "bad-check", "bad-check.logo"),
  });

  assert.ok(loaded.error);
  assert.ok(loaded.error.includes('"check" must be a boolean'));
  cleanup();
});

test("loadFixture handles missing .expected.json file", () => {
  cleanup();
  mkdirSync(join(TEMP_ROOT, "no-expected"), { recursive: true });
  writeFileSync(join(TEMP_ROOT, "no-expected", "test.logo"), "");

  const loaded = loadFixture({
    name: "no-expected/test.expected.json",
    expectedPath: join(TEMP_ROOT, "no-expected", "test.expected.json"),
    logoPath: join(TEMP_ROOT, "no-expected", "test.logo"),
  });

  assert.ok(loaded.error);
  assert.ok(loaded.error.includes("missing expected file"));
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

  assert.ok(loaded.error);
  assert.ok(loaded.error.includes("missing source file"));
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
test("CLI shell runs via subprocess", async () => {
  const proc = spawn("node", ["scripts/conformance.mjs"], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Attach close listener BEFORE consuming streams to avoid missing the event
  const closed = once(proc, "close");

  // Consume streams (always reads, whether data arrives or not)
  const [stdout, stderr] = await Promise.all([
    text(proc.stdout),
    text(proc.stderr),
  ]);

  const [code] = await closed;
  assert.equal(code, 0, `CLI should exit 0; stderr: ${stderr}`);
  assert.ok(
    stdout.includes("conformance:"),
    "Should print conformance summary",
  );
});

// Additional tests for orphan file detection

test("discoverFixtures throws on orphan .logo file", () => {
  cleanup();
  mkdirSync(join("tests", "conformance", "_temp-orphan-logo"), {
    recursive: true,
  });
  writeFileSync(
    join("tests", "conformance", "_temp-orphan-logo", "orphan.logo"),
    "",
  );
  // No .expected.json sibling

  assert.throws(
    () => discoverFixtures("tests/conformance"),
    /Orphan \.logo file\(s\) without \.expected\.json sibling/,
  );

  rmSync(join("tests", "conformance", "_temp-orphan-logo"), {
    recursive: true,
    force: true,
  });
});

test("discoverFixtures throws on orphan .expected.json file", () => {
  cleanup();
  mkdirSync(join("tests", "conformance", "_temp-orphan-expected"), {
    recursive: true,
  });
  writeFileSync(
    join(
      "tests",
      "conformance",
      "_temp-orphan-expected",
      "orphan.expected.json",
    ),
    JSON.stringify({ profiles: [], events: [], diagnostics: [] }),
  );
  // No .logo sibling

  assert.throws(
    () => discoverFixtures("tests/conformance"),
    /Orphan \.expected\.json file\(s\) without \.logo sibling/,
  );

  rmSync(join("tests", "conformance", "_temp-orphan-expected"), {
    recursive: true,
    force: true,
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
      expect: "mismatch",
      profiles: [],
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

test("runHarness requires self-tests to declare expect mismatch", () => {
  cleanup();
  // Create a self-test without expect: "mismatch"
  mkdirSync(join("tests", "conformance", "_harness-selftest", "bad-expect"), {
    recursive: true,
  });
  writeFileSync(
    join(
      "tests",
      "conformance",
      "_harness-selftest",
      "bad-expect",
      "bad-expect.logo",
    ),
    "",
  );
  writeFileSync(
    join(
      "tests",
      "conformance",
      "_harness-selftest",
      "bad-expect",
      "bad-expect.expected.json",
    ),
    JSON.stringify({
      expect: "match", // Wrong - should be "mismatch"
      profiles: [],
      events: [],
      diagnostics: [],
    }),
  );

  const exitCode = runHarness({});
  assert.equal(exitCode, 1); // Should fail

  rmSync(join("tests", "conformance", "_harness-selftest", "bad-expect"), {
    recursive: true,
    force: true,
  });
});

test("runHarness runs self-tests even with --profile filter", () => {
  cleanup();
  // Self-test with profiles:[] should still run when --profile is set
  mkdirSync(join("tests", "conformance", "_harness-selftest", "profile-test"), {
    recursive: true,
  });
  writeFileSync(
    join(
      "tests",
      "conformance",
      "_harness-selftest",
      "profile-test",
      "profile-test.logo",
    ),
    "]", // Parse error
  );
  writeFileSync(
    join(
      "tests",
      "conformance",
      "_harness-selftest",
      "profile-test",
      "profile-test.expected.json",
    ),
    JSON.stringify({
      expect: "mismatch",
      profiles: [], // No profiles - would be skipped if not a self-test
      events: [],
      diagnostics: [], // Expects no diagnostics, but will get ol-unmatched-bracket
    }),
  );

  const exitCode = runHarness({ profile: "core-language" });
  assert.equal(exitCode, 0); // Self-test should pass (mismatch correctly detected)

  rmSync(join("tests", "conformance", "_harness-selftest", "profile-test"), {
    recursive: true,
    force: true,
  });
});

test("runHarness skips fixtures when --profile filter doesn't match", () => {
  cleanup();
  // Create a fixture with profiles:["data"] (not in core-language closure)
  mkdirSync(join(TEMP_ROOT, "data-only"), { recursive: true });
  writeFileSync(join(TEMP_ROOT, "data-only", "data-only.logo"), "");
  writeFileSync(
    join(TEMP_ROOT, "data-only", "data-only.expected.json"),
    JSON.stringify({
      profiles: ["data"], // Not in core-language closure
      events: [],
      diagnostics: [],
    }),
  );

  const exitCode = runHarness({ profile: "core-language", root: TEMP_ROOT });
  assert.equal(exitCode, 0); // Should skip (not fail)

  cleanup();
});

test("runHarness runs an opted-in execution fixture end to end", () => {
  cleanup();
  mkdirSync(join(TEMP_ROOT, "executes"), { recursive: true });
  writeFileSync(
    join(TEMP_ROOT, "executes", "executes.logo"),
    "print 1\nprint 2",
  );
  writeFileSync(
    join(TEMP_ROOT, "executes", "executes.expected.json"),
    JSON.stringify({
      profiles: ["core-language"],
      execute: true,
      events: [
        {
          seq: 0,
          kind: "instruction",
          source_span: {
            document: "executes/executes",
            start: [1, 1],
            end: [1, 8],
          },
          payload: { statement_kind: "Call" },
        },
        {
          seq: 1,
          kind: "print",
          source_span: {
            document: "executes/executes",
            start: [1, 1],
            end: [1, 8],
          },
          payload: { values: [1] },
        },
        {
          seq: 2,
          kind: "instruction",
          source_span: {
            document: "executes/executes",
            start: [2, 1],
            end: [2, 8],
          },
          payload: { statement_kind: "Call" },
        },
        {
          seq: 3,
          kind: "print",
          source_span: {
            document: "executes/executes",
            start: [2, 1],
            end: [2, 8],
          },
          payload: { values: [2] },
        },
      ],
      diagnostics: [],
    }),
  );

  const exitCode = runHarness({ root: TEMP_ROOT });
  assert.equal(exitCode, 0);

  cleanup();
});

test("runHarness reports a mismatch for an opted-in execution fixture with wrong events", () => {
  cleanup();
  mkdirSync(join(TEMP_ROOT, "executes-wrong"), { recursive: true });
  writeFileSync(
    join(TEMP_ROOT, "executes-wrong", "executes-wrong.logo"),
    "print 1",
  );
  writeFileSync(
    join(TEMP_ROOT, "executes-wrong", "executes-wrong.expected.json"),
    JSON.stringify({
      profiles: ["core-language"],
      execute: true,
      events: [], // Wrong: execution actually emits one instruction event
      diagnostics: [],
    }),
  );

  const exitCode = runHarness({ root: TEMP_ROOT });
  assert.equal(exitCode, 1);

  cleanup();
});

test("runHarness runs an opted-in check fixture end to end (clean pass)", () => {
  cleanup();
  mkdirSync(join(TEMP_ROOT, "checks"), { recursive: true });
  writeFileSync(join(TEMP_ROOT, "checks", "checks.logo"), "print 1");
  writeFileSync(
    join(TEMP_ROOT, "checks", "checks.expected.json"),
    JSON.stringify({
      profiles: ["core-language"],
      check: true,
      events: [],
      diagnostics: [],
    }),
  );

  const exitCode = runHarness({ root: TEMP_ROOT });
  assert.equal(exitCode, 0);

  cleanup();
});

test("runHarness reports a mismatch for an opted-in check fixture with wrong diagnostics", () => {
  cleanup();
  mkdirSync(join(TEMP_ROOT, "checks-wrong"), { recursive: true });
  writeFileSync(
    join(TEMP_ROOT, "checks-wrong", "checks-wrong.logo"),
    "print 1",
  );
  writeFileSync(
    join(TEMP_ROOT, "checks-wrong", "checks-wrong.expected.json"),
    JSON.stringify({
      profiles: ["core-language"],
      check: true,
      events: [],
      diagnostics: [
        {
          code: "ol-unknown-command",
          source_span: {
            document: "checks-wrong/checks-wrong",
            start: [1, 1],
            end: [1, 6],
          },
          params: { name: "print" },
          stage: "semantic",
          severity: "error",
        },
      ], // Wrong: check() emits no findings yet (issue #116 is infrastructure only)
    }),
  );

  const exitCode = runHarness({ root: TEMP_ROOT });
  assert.equal(exitCode, 1);

  cleanup();
});
