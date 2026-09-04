// Unit tests for the conformance harness logic module. Per ADR-0009, these tests import the
// harness module directly to achieve 100% coverage, plus one subprocess test for the CLI shell.

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { text } from "node:stream/consumers";
import { OLDict, OLRecord } from "@openlogo/core";
import {
  PROFILE_DEPS,
  EXPECTED_SUFFIX,
  closureOf,
  deepEqual,
  produce,
  validateDiagnostics,
  discoverFixtures,
  loadFixture,
  fixtureErrors,
  compare,
  diffStream,
  hasGraphMarkers,
  graphEqual,
  safeStringify,
  itemsMatch,
  parseArgs,
  profileGateErrors,
  runHarness,
  validateExecuteOptions,
} from "./harness/index.mjs";

// Each self-test gets its own fresh, uniquely-named OS temp directory (fs.mkdtempSync) — never a
// shared or relative fixture path (issue #140). Previously many self-tests shared a single
// ".temp-test-fixtures" directory, and several wrote fixtures directly into the real,
// git-tracked tests/conformance/ tree, then removed them again — safe only as long as every test
// ran to completion in strict sequence. `afterEach` runs even when a test fails, so cleanup can
// never be skipped and leak state into a later test.
let TEMP_ROOT;

beforeEach(() => {
  TEMP_ROOT = mkdtempSync(join(tmpdir(), "ol-conformance-"));
});

afterEach(() => {
  rmSync(TEMP_ROOT, { recursive: true, force: true });
});

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

test("deepEqual unwraps an actual OLDict into its key/value contents, so its exact contents are genuinely compared", () => {
  const dict = new OLDict();
  dict.set("tom", 8);
  dict.set("sophie", 6);
  assert.ok(deepEqual({ tom: 8, sophie: 6 }, dict));
  // Deliberately corrupt the expected contents: this must now genuinely fail, not silently pass.
  assert.ok(!deepEqual({ tom: 8, sophie: 999 }, dict));
  assert.ok(!deepEqual({ tom: 8 }, dict)); // missing key
  assert.ok(!deepEqual({ tom: 8, sophie: 6, extra: 1 }, dict)); // extra key
});

test("deepEqual unwraps an actual OLRecord into its field contents, so its exact contents are genuinely compared", () => {
  const point = new OLRecord("point", ["x", "y"], [3, 4]);
  assert.ok(deepEqual({ x: 3, y: 4 }, point));
  // Deliberately corrupt the expected contents: this must now genuinely fail, not silently pass.
  assert.ok(!deepEqual({ x: 3, y: 999 }, point));
  assert.ok(!deepEqual({ x: 3 }, point)); // missing field
});

test("deepEqual: a type-less expected shape matches ANY struct type with the same field contents (documented default; opting into __type below is how a fixture asks for more)", () => {
  const point = new OLRecord("point", ["x", "y"], [3, 4]);
  const vector = new OLRecord("vector", ["x", "y"], [3, 4]);
  const typelessExpected = { x: 3, y: 4 };
  // Neither struct type is rejected: without an explicit "__type" opt-in, a plain field shape
  // genuinely cannot tell "point" and "vector" apart (rubber-duck-reported gap). This is exactly
  // why the "__type" opt-in test below exists — to prove the gap is now closeable, not that this
  // permissive default itself is a bug.
  assert.ok(deepEqual(typelessExpected, point));
  assert.ok(deepEqual(typelessExpected, vector));
});

test("deepEqual's __type opt-in distinguishes two records with identical field contents but different struct types (Bug 5 follow-up)", () => {
  const point = new OLRecord("point", ["x", "y"], [3, 4]);
  const vector = new OLRecord("vector", ["x", "y"], [3, 4]);
  const expectedPoint = { __type: "point", x: 3, y: 4 };
  // Same struct type, same fields: still correctly reported as equal (don't break the existing,
  // correct case).
  assert.ok(deepEqual(expectedPoint, point));
  // Same field contents, DIFFERENT struct type: before this fix, `unwrapDataValue` discarded the
  // record's type entirely, so this and `point` above were indistinguishable to `deepEqual`. Now
  // correctly reported as NOT equal.
  assert.ok(!deepEqual(expectedPoint, vector));
  // The type mismatch is caught even when the fields also happen to differ, not merely deferred
  // to (and masked by) a field-level mismatch.
  const otherVector = new OLRecord("vector", ["x", "y"], [3, 999]);
  assert.ok(!deepEqual(expectedPoint, otherVector));
});

test("deepEqual deep-compares a dict nested inside a list/object, unwrapping at every level", () => {
  const inner = new OLDict();
  inner.set("count", 2);
  assert.ok(deepEqual({ values: [{ count: 2 }] }, { values: [inner] }));
  assert.ok(!deepEqual({ values: [{ count: 3 }] }, { values: [inner] }));
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

test("produce does not run style lints under check() by default (shouldStyle omitted)", () => {
  // `:X = 1` is a style-name-case violation, but style lints are opt-in — with shouldStyle
  // omitted (defaulting to false) check() must not report it even though check:true is set.
  const result = produce(":X = 1", "test-doc", false, true, ["core-language"]);
  assert.deepEqual(result.diagnostics, []);
});

test("produce threads shouldStyle through to check()'s Layer-3 style lints", () => {
  const result = produce(
    ":X = 1",
    "test-doc",
    false,
    true,
    ["core-language"],
    true,
  );
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-style-name-case");
  assert.deepEqual(result.diagnostics[0].params, { name: "X" });
});

// Coverage-anchor tests (issue #140 follow-up): `for ... from ... to ... by` (issue #103) has four
// error-propagation branches — a failing `from`/`to`/`by` expression, and a failing loop-body
// statement — that, at the time this PR was written, no corpus fixture or `@openlogo/runtime` unit
// test exercised directly (its own for-loop-binders.test.mjs only covered the
// *unsupported-expression* skip branch, a different code path). Coverage of these branches was
// previously an accident of merged coverage across the whole `node --test` run, which made it
// flaky (sometimes ~90% present, sometimes not, independent of this file's own isolation fix).
// Calling `produce(..., true)` here exercises `@openlogo/runtime`'s `execute()` directly and
// deterministically, so these branches are covered on every run.
//
// Update (issue #173): `packages/runtime/src/for-loop-binders.test.mjs` later gained its own
// direct tests for these exact four branches (added by #97/#171/#174, using `1 / 0` in place of
// `:undef`). These four tests here are now redundant with those — an #173 audit confirmed removing
// either set alone still leaves the branches at 100% via the other — but are kept as defense-in-
// depth at the harness level rather than removed, since deleting test coverage is out of this
// issue's scope. Prefer the `packages/runtime/**` tests as the canonical/idiomatic home for new
// runtime-error-path coverage going forward; this file's job is the harness, not the runtime.
test("produce/execute propagates a failing `for` `from` expression's diagnostic", () => {
  const result = produce(
    "for i from :undef to 5 [\n  print :i\n]",
    "test-doc",
    true,
  );
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
  assert.deepEqual(
    result.events.filter((event) => event.kind === "print"),
    [],
  );
});

test("produce/execute propagates a failing `for` `to` expression's diagnostic", () => {
  const result = produce(
    "for i from 1 to :undef [\n  print :i\n]",
    "test-doc",
    true,
  );
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
  assert.deepEqual(
    result.events.filter((event) => event.kind === "print"),
    [],
  );
});

test("produce/execute propagates a failing `for` `by` expression's diagnostic", () => {
  const result = produce(
    "for i from 1 to 5 by :undef [\n  print :i\n]",
    "test-doc",
    true,
  );
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
  assert.deepEqual(
    result.events.filter((event) => event.kind === "print"),
    [],
  );
});

test("produce/execute propagates a failing statement inside a `for` range body, stopping the loop", () => {
  const result = produce(
    "for i from 1 to 5 [\n  print :undef\n]",
    "test-doc",
    true,
  );
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
  // The loop stopped on its first pass: no print event ever completed.
  assert.deepEqual(
    result.events.filter((event) => event.kind === "print"),
    [],
  );
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

test("compare() compares a diagnostic message when — and only when — the fixture opted in with compareMessages, so a wrong learner sentence fails (issue #1025)", () => {
  // The opt-in is the explicit per-fixture `"compareMessages": true`, NOT the presence of a
  // `message` key: the corpus carried 306 messages written while the documented behaviour was
  // "message is not compared", and reading those as consent would have frozen ~275 English
  // sentences that spec/error-model.md:263-265 positively permits an implementation to reword.
  // spec/error-model.md:256-261 stays the default — identity is code+params. :125 is the case this
  // exists for: it prescribes the sentence AND makes *keyword*/*primitive*/*alias* a MUST NOT
  // inside it, and #751 and #871 both shipped a message violating that while the corpus stayed
  // green, because compare() dropped `message` unconditionally.
  const diagnostic = (message) => ({
    code: "ol-reserved-word",
    source_span: { document: "test", start: [1, 8], end: [1, 15] },
    params: { name: "forward" },
    stage: "semantic",
    severity: "error",
    message,
  });
  const right = "forward is already part of OpenLogo. choose another name.";
  const wrong =
    "forward is already a reserved primitive, so it can't be redefined here.";

  const agreeing = compare(
    { compareMessages: true, events: [], diagnostics: [diagnostic(right)] },
    { events: [], diagnostics: [diagnostic(right)] },
  );
  assert.ok(
    agreeing.matched,
    "an opted-in fixture whose message is right must still pass",
  );

  const diverging = compare(
    { compareMessages: true, events: [], diagnostics: [diagnostic(right)] },
    { events: [], diagnostics: [diagnostic(wrong)] },
  );
  assert.ok(
    !diverging.matched,
    "an opted-in fixture must fail when the producer's message is wrong",
  );
  assert.ok(diverging.report.includes("diagnostic mismatch"));
  assert.ok(
    diverging.report.includes("reserved primitive"),
    "the report must name the offending prose so the failure is actionable",
  );

  // The control that makes the two assertions above mean something: the SAME wrong message, with
  // the flag absent, matches. So it is the opt-in doing the work, not some other field.
  const notOptedIn = compare(
    { events: [], diagnostics: [diagnostic(right)] },
    { events: [], diagnostics: [diagnostic(wrong)] },
  );
  assert.ok(
    notOptedIn.matched,
    "without compareMessages the localization boundary is preserved",
  );
});

test("compare() ignores a diagnostic message the expected side did not ask for, keeping the localization boundary for every fixture that has not opted in", () => {
  // The arm no fixture can express: a fixture asserting "prose is NOT compared" would have to
  // record the prose it is not asserting — and loadFixture now rejects a `message` without the
  // flag outright, so this shape only exists in-memory. Every diagnostic `produce()` returns
  // carries a message (validateDiagnostics makes that a hard requirement), so this is the shape of
  // the corpus diagnostics that deliberately stay on identity alone — the majority of them.
  // HOW MANY is deliberately not written here. This sentence used to say "the 326 corpus
  // diagnostics", a hand-written count nothing re-checked: it described the design of #1025's
  // review round 1, which round 2 reversed, and it was already stale when #1026 shipped. The split
  // is derived from the corpus by `the corpus is majority identity-only` below instead, which is
  // also what makes "the majority" a checked claim rather than another number in prose
  // (issue #1028). `tests/conformance/README.md` declines to state a count for the same reason.
  const expected = {
    events: [],
    diagnostics: [
      {
        code: "ol-test",
        source_span: { document: "test", start: [1, 1], end: [1, 2] },
        params: {},
        stage: "parse",
        severity: "error",
        // no message field: this fixture asserts identity only
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
        message: "any prose at all, in any language",
      },
    ],
  };
  const result = compare(expected, actual);
  assert.ok(
    result.matched,
    "Expected without message should match actual with message",
  );
});

test("the corpus is majority identity-only, and the split is derived here rather than written into a comment (issue #1028)", () => {
  // What replaces the stale 326 above. A count in prose is an assertion nothing re-checks, so this
  // one is computed from the real corpus every run, through the harness's own loader — the census
  // therefore counts exactly what the harness counts. `loadFixture` now makes a `message` and the
  // `compareMessages` opt-in imply each other in both directions, so "carries a message" and "is
  // compared on prose" are the same set, and no third state can hide between them.
  let identityOnly = 0;
  let compared = 0;
  for (const fixture of discoverFixtures()) {
    const loaded = loadFixture(fixture);
    assert.equal(loaded.error, undefined, `${fixture.name}: ${loaded.error}`);
    for (const diagnostic of loaded.expected.diagnostics) {
      if (Object.hasOwn(diagnostic, "message")) {
        compared += 1;
      } else {
        identityOnly += 1;
      }
    }
  }

  assert.ok(
    compared > 0,
    "no corpus diagnostic asserts its prose — the opt-in would be a mechanism nothing exercises",
  );
  assert.ok(
    identityOnly > compared,
    `identity-only (${identityOnly}) is no longer the majority over compared (${compared}). That is not forbidden by anything — the spec fixes no corpus ratio — but the characterization just above this test describes identity-only as the majority shape, so one of the two now needs updating`,
  );
});

test("compare() keeps the per-diagnostic grain inside an opted-in fixture: a sibling with no message is still identity-only (issue #1025)", () => {
  // `compareMessages` is per fixture, as the issue required, but within one fixture only the
  // diagnostics that actually carry a message are asserted on prose — so a fixture may pin the one
  // sentence the spec fixes and leave its siblings free to be reworded.
  const span = { document: "test", start: [1, 1], end: [1, 2] };
  const pinned = {
    code: "ol-reserved-word",
    source_span: span,
    params: { name: "forward" },
    stage: "semantic",
    severity: "error",
    message: "forward is already part of OpenLogo. choose another name.",
  };
  const loose = {
    code: "ol-test",
    source_span: span,
    params: {},
    stage: "parse",
    severity: "error",
  };
  const result = compare(
    { compareMessages: true, events: [], diagnostics: [pinned, loose] },
    {
      events: [],
      diagnostics: [pinned, { ...loose, message: "reworded freely" }],
    },
  );
  assert.ok(result.matched);
});

test("compare() projects a surplus actual diagnostic that has no expected counterpart to consult, and still reports it as surplus (issue #1025)", () => {
  // The index-aligned opt-in has to answer "what does actual[1] compare, when expected[1] does not
  // exist?". It compares identity only — there is no expectation to have opted in — and the extra
  // diagnostic is reported as surplus either way. Pinned because the alternative, reading a
  // `message` off `undefined`, throws.
  const shared = {
    code: "ol-test",
    source_span: { document: "test", start: [1, 1], end: [1, 2] },
    params: {},
    stage: "parse",
    severity: "error",
    message: "first",
  };
  const result = compare(
    { compareMessages: true, events: [], diagnostics: [shared] },
    { events: [], diagnostics: [shared, { ...shared, message: "second" }] },
  );
  assert.ok(!result.matched, "a surplus actual diagnostic must be reported");
  assert.ok(result.report.includes("(missing)"));
});

// --- Graph fixtures: $id/$ref reference-identity extension (issue #495 fixture-format
// follow-up) -----------------------------------------------------------------------------------

test("hasGraphMarkers is false for plain values (no markers anywhere)", () => {
  assert.equal(hasGraphMarkers(42), false);
  assert.equal(hasGraphMarkers("word"), false);
  assert.equal(hasGraphMarkers(null), false);
  assert.equal(hasGraphMarkers([1, 2, { a: [3, 4] }]), false);
  assert.equal(hasGraphMarkers({ code: "ol-foo", params: {} }), false);
});

test("hasGraphMarkers finds a $id or $ref marker at any depth", () => {
  assert.ok(hasGraphMarkers({ $id: "n1", $value: [1, 2] }));
  assert.ok(hasGraphMarkers({ $ref: "n1" }));
  assert.ok(hasGraphMarkers([1, { nested: { $ref: "n1" } }]));
  assert.ok(hasGraphMarkers({ values: [[{ $id: "n1", $value: 1 }]] }));
});

test("graphEqual: two $ref to the same $id match only the same actual reference", () => {
  const sharedActual = [1, 2];
  const expected = {
    $id: "n1",
    $value: [1, 2],
  };
  const first = graphEqual(expected, sharedActual);
  assert.ok(first.matched, first.reason);

  // A second position tagged with $ref "n1" must resolve to that exact same actual reference.
  const ctx = { idToActual: new Map(), actualToId: new Map() };
  assert.ok(
    graphEqual({ $id: "n1", $value: [1, 2] }, sharedActual, ctx).matched,
  );
  assert.ok(graphEqual({ $ref: "n1" }, sharedActual, ctx).matched);

  // ...but not an equal-but-distinct copy.
  const ctx2 = { idToActual: new Map(), actualToId: new Map() };
  assert.ok(
    graphEqual({ $id: "n1", $value: [1, 2] }, sharedActual, ctx2).matched,
  );
  const mismatch = graphEqual({ $ref: "n1" }, [1, 2], ctx2);
  assert.ok(!mismatch.matched);
  assert.match(mismatch.reason, /different reference/);
});

test("graphEqual: a $ref with no earlier $id is a clean mismatch, not a crash", () => {
  const result = graphEqual({ $ref: "missing" }, [1, 2]);
  assert.ok(!result.matched);
  assert.match(result.reason, /no earlier \$id/);
});

test("graphEqual: $id against a primitive actual delegates to plain value equality (identity is moot for primitives)", () => {
  const matched = graphEqual({ $id: "n1", $value: 1 }, 1);
  assert.ok(matched.matched, matched.reason);

  const mismatched = graphEqual({ $id: "n1", $value: 1 }, 2);
  assert.ok(!mismatched.matched);
  assert.match(mismatched.reason, /value mismatch/);
});

test("graphEqual: a self-referential actual list terminates via $ref back-reference", () => {
  const cyclic = [1, 2];
  cyclic.push(cyclic);
  const expected = { $id: "n1", $value: [1, 2, { $ref: "n1" }] };
  const result = graphEqual(expected, cyclic);
  assert.ok(result.matched, result.reason);
});

test("graphEqual: an unrelated second path reaching the same actual reference must be tagged", () => {
  const shared = [1];
  const outer = [shared, shared];
  // Both positions correctly tagged: matches.
  const tagged = graphEqual(
    [{ $id: "n1", $value: [1] }, { $ref: "n1" }],
    outer,
  );
  assert.ok(tagged.matched, tagged.reason);

  // Second position left untagged (plain [1]): the fixture didn't declare the aliasing, so an
  // actual reference already bound to "n1" reappearing here is reported, not silently accepted.
  const untagged = graphEqual([{ $id: "n1", $value: [1] }, [1]], outer);
  assert.ok(!untagged.matched);
  assert.match(untagged.reason, /unexpected aliasing/);
});

test("graphEqual: same actual reference under two distinct $id labels is a mismatch", () => {
  const shared = [1];
  const outer = [shared, shared];
  const result = graphEqual(
    [
      { $id: "n1", $value: [1] },
      { $id: "n2", $value: [1] },
    ],
    outer,
  );
  assert.ok(!result.matched);
  assert.match(result.reason, /unexpected aliasing/);
});

test("graphEqual: reusing the same $id label for two different actual references is a mismatch, not a silent rebind", () => {
  const a = [1];
  const b = [2];
  const result = graphEqual(
    [
      { $id: "n1", $value: [1] },
      { $id: "n1", $value: [2] },
    ],
    [a, b],
  );
  assert.ok(!result.matched);
  assert.match(result.reason, /declared more than once/);
});

test("graphEqual: reusing the same $id label for the SAME actual reference is still a mismatch — a repeat occurrence must use $ref, not a second $id", () => {
  const shared = [1];
  const result = graphEqual(
    [
      { $id: "n1", $value: [1] },
      { $id: "n1", $value: [1] },
    ],
    [shared, shared],
  );
  assert.ok(!result.matched);
  assert.match(result.reason, /declared more than once/);
  assert.match(result.reason, /\$ref "n1"/);
});

test("graphEqual falls through to plain structural comparison beneath a tagged node", () => {
  const matched = graphEqual(
    { $id: "n1", $value: { a: 1, b: [1, 2] } },
    { a: 1, b: [1, 2] },
  );
  assert.ok(matched.matched, matched.reason);

  const mismatched = graphEqual(
    { $id: "n1", $value: { a: 1, b: [1, 2] } },
    { a: 1, b: [1, 3] },
  );
  assert.ok(!mismatched.matched);
});

test("graphEqual reports plain object/array shape mismatches with a reason", () => {
  assert.match(graphEqual([1, 2], [1, 2, 3]).reason, /array shape mismatch/);
  assert.match(graphEqual({ a: 1 }, { a: 1, b: 2 }).reason, /object shape/);
  assert.match(graphEqual({ a: 1 }, { b: 1 }).reason, /missing key/);
  assert.match(graphEqual(1, "1").reason, /value mismatch/);
  assert.match(graphEqual(null, {}).reason, /value mismatch/);
});

test("graphEqual unwraps an actual OLDict for structural comparison, so its exact contents are genuinely compared", () => {
  const dict = new OLDict();
  dict.set("tom", 8);
  dict.set("sophie", 6);
  assert.ok(graphEqual({ tom: 8, sophie: 6 }, dict).matched);
  const mismatch = graphEqual({ tom: 8, sophie: 999 }, dict);
  assert.ok(!mismatch.matched);
});

test("graphEqual unwraps an actual OLRecord for structural comparison, so its exact contents are genuinely compared", () => {
  const point = new OLRecord("point", ["x", "y"], [3, 4]);
  assert.ok(graphEqual({ x: 3, y: 4 }, point).matched);
  const mismatch = graphEqual({ x: 3, y: 999 }, point);
  assert.ok(!mismatch.matched);
});

test("graphEqual's __type opt-in distinguishes two records with identical field contents but different struct types (Bug 5 follow-up)", () => {
  const point = new OLRecord("point", ["x", "y"], [3, 4]);
  const vector = new OLRecord("vector", ["x", "y"], [3, 4]);
  const expectedPoint = { __type: "point", x: 3, y: 4 };
  // Same struct type, same fields: still correctly reported as equal.
  assert.ok(graphEqual(expectedPoint, point).matched);
  // Same field contents, different struct type: must now be reported as NOT equal, with a
  // reason identifying the type mismatch (previously indistinguishable via unwrapped fields alone).
  const mismatch = graphEqual(expectedPoint, vector);
  assert.ok(!mismatch.matched);
  assert.match(mismatch.reason, /record type mismatch/);
  // Without the opt-in, a type-less expected shape still matches either struct type (unchanged,
  // backward-compatible default).
  assert.ok(graphEqual({ x: 3, y: 4 }, vector).matched);
});

test("graphEqual tracks $id/$ref identity on the original OLDict reference, not the unwrapped view", () => {
  const dict = new OLDict();
  dict.set("count", 1);
  const ctx = { idToActual: new Map(), actualToId: new Map() };
  assert.ok(graphEqual({ $id: "d1", $value: { count: 1 } }, dict, ctx).matched);
  // A later $ref to the same label must resolve to this exact OLDict reference again, even
  // though each visit unwraps it into a brand-new plain-object view for structural comparison.
  assert.ok(graphEqual({ $ref: "d1" }, dict, ctx).matched);
  // A different (but structurally equal) OLDict is NOT the same reference.
  const otherDict = new OLDict();
  otherDict.set("count", 1);
  const mismatch = graphEqual({ $ref: "d1" }, otherDict, ctx);
  assert.ok(!mismatch.matched);
});

test("safeStringify replaces an already-visited reference with a circular marker", () => {
  const cyclic = [1, 2];
  cyclic.push(cyclic);
  const text = safeStringify(cyclic);
  assert.ok(text.includes("[[circular]]"));
  assert.doesNotThrow(() => text);
});

test("safeStringify renders an acyclic-but-shared reference in full at each occurrence", () => {
  const shared = [1, 2];
  const outer = [shared, shared];
  const text = safeStringify(outer);
  assert.strictEqual(text, "[[1,2],[1,2]]");
  assert.ok(!text.includes("[[circular]]"));
});

test("safeStringify falls back gracefully for an unstringifiable value", () => {
  const withBigInt = { n: 10n };
  const text = safeStringify(withBigInt);
  assert.match(text, /unstringifiable/);
});

test("itemsMatch dispatches to graphEqual only when the expected side has graph markers", () => {
  assert.ok(itemsMatch({ a: 1 }, { a: 1 }).matched);
  assert.ok(!itemsMatch({ a: 1 }, { a: 2 }).matched);

  const shared = [1];
  const ctx = { idToActual: new Map(), actualToId: new Map() };
  assert.ok(itemsMatch({ $id: "n1", $value: [1] }, shared, ctx).matched);
  assert.ok(itemsMatch({ $ref: "n1" }, shared, ctx).matched);
});

test("itemsMatch reports a clean mismatch instead of crashing on an undeclared cyclic actual", () => {
  const cyclicActual = [1];
  cyclicActual.push(cyclicActual);
  const cyclicExpected = [1];
  cyclicExpected.push(cyclicExpected);
  // Both sides are genuinely cyclic (no $id/$ref), so plain deepEqual would recurse forever;
  // itemsMatch must catch the resulting stack overflow and report it, not crash the harness.
  const result = itemsMatch(cyclicExpected, cyclicActual);
  assert.ok(!result.matched);
  assert.match(result.reason, /comparison error/);
});

test("diffStream uses graphEqual for a $id/$ref-tagged expected item and reports its reason", () => {
  const expected = [{ seq: 0, $id: "n1", $value: { list: [1] } }];
  const actual = [{ seq: 0, list: [1] }];
  // Not graph-tagged at this level (the whole event object isn't wrapped) -- demonstrate the
  // more realistic nested case instead: a payload value tagged inside a normal event object.
  const expectedEvents = [
    {
      seq: 0,
      kind: "print",
      payload: { values: [{ $id: "n1", $value: [1, 2] }] },
    },
  ];
  const sharedList = [1, 2];
  const actualEvents = [
    { seq: 0, kind: "print", payload: { values: [sharedList] } },
  ];
  // diffStream gives every item its own fresh graph-identity ctx internally — no ctx argument
  // is passed (or needed) by callers.
  assert.equal(diffStream("event", "seq", expectedEvents, actualEvents), null);

  const wrongActualEvents = [
    { seq: 0, kind: "print", payload: { values: [[1, 2, 3]] } },
  ];
  const report = diffStream("event", "seq", expectedEvents, wrongActualEvents);
  assert.ok(report);
  assert.ok(report.includes("event mismatch"));

  // silence unused-var lint for the illustrative-but-unused variables above
  void expected;
  void actual;
});

test("diffStream gives each stream item its own fresh $id/$ref ctx: an $id declared in one event is invisible to another", () => {
  const sharedList = [1, 2];
  // seq 1's $ref points at seq 0's $id — per spec/execution-model.md, effect events are
  // independently captured, sealed snapshots with no cross-event identity guarantee, so this
  // must be reported as an undefined reference even though the actual runtime output happens to
  // reuse the very same underlying reference at both positions.
  const expectedEvents = [
    {
      seq: 0,
      kind: "print",
      payload: { values: [{ $id: "shared", $value: [1, 2] }] },
    },
    { seq: 1, kind: "print", payload: { values: [{ $ref: "shared" }] } },
  ];
  const actualEvents = [
    { seq: 0, kind: "print", payload: { values: [sharedList] } },
    { seq: 1, kind: "print", payload: { values: [sharedList] } },
  ];
  const report = diffStream("event", "seq", expectedEvents, actualEvents);
  assert.ok(report);
  assert.match(report, /has no earlier \$id in this fixture/);
});

test("diffStream still resolves a $ref against an $id declared earlier in the SAME event", () => {
  // Both the $id and its $ref live inside seq 0's own payload — this must keep working exactly
  // as before; only cross-event resolution is rejected.
  const expectedEvents = [
    {
      seq: 0,
      kind: "print",
      payload: {
        values: [{ $id: "a", $value: [1, 2] }, { $ref: "a" }],
      },
    },
  ];
  const sharedList = [1, 2];
  const actualEvents = [
    { seq: 0, kind: "print", payload: { values: [sharedList, sharedList] } },
  ];
  assert.equal(diffStream("event", "seq", expectedEvents, actualEvents), null);
});

test("compare() scopes $id/$ref to a single event: a $ref naming a DIFFERENT event's $id is an undefined reference, not a silent cross-event resolution", () => {
  const sharedList = [1, 2];
  const expected = {
    events: [
      {
        seq: 0,
        kind: "print",
        payload: { values: [{ $id: "shared", $value: [1, 2] }] },
      },
      { seq: 1, kind: "print", payload: { values: [{ $ref: "shared" }] } },
    ],
    diagnostics: [],
  };
  // The actual output legitimately reuses the same underlying reference at both positions (a
  // real implementation detail an aliasing-unaware fixture might once have relied on) — the fix
  // must reject this regardless, since the spec makes no cross-event identity guarantee.
  const actual = {
    events: [
      { seq: 0, kind: "print", payload: { values: [sharedList] } },
      { seq: 1, kind: "print", payload: { values: [sharedList] } },
    ],
    diagnostics: [],
  };
  const result = compare(expected, actual);
  assert.ok(!result.matched);
  assert.match(result.report, /has no earlier \$id in this fixture/);
});

test("compare() still resolves a $ref against an $id declared earlier in the SAME event (issue #495 fixtures keep passing)", () => {
  const sharedList = [1, 2];
  const expected = {
    events: [
      {
        seq: 0,
        kind: "print",
        payload: {
          values: [[{ $id: "a", $value: [1, 2] }, { $ref: "a" }]],
        },
      },
    ],
    diagnostics: [],
  };
  const actual = {
    events: [
      {
        seq: 0,
        kind: "print",
        payload: { values: [[sharedList, sharedList]] },
      },
    ],
    diagnostics: [],
  };
  const result = compare(expected, actual);
  assert.ok(result.matched, result.report);
});

test("compare() does not leak $id/$ref ctx between the event stream and the diagnostic stream", () => {
  const sharedParams = { value: [1, 2] };
  const expected = {
    events: [
      {
        seq: 0,
        kind: "print",
        payload: { values: [{ $id: "shared", $value: [1, 2] }] },
      },
    ],
    diagnostics: [
      {
        code: "ol-type",
        source_span: {},
        params: { $ref: "shared" },
        stage: "runtime",
        severity: "error",
      },
    ],
  };
  const actual = {
    events: [
      { seq: 0, kind: "print", payload: { values: [sharedParams.value] } },
    ],
    diagnostics: [
      {
        code: "ol-type",
        source_span: {},
        params: sharedParams.value,
        stage: "runtime",
        severity: "error",
      },
    ],
  };
  const result = compare(expected, actual);
  assert.ok(!result.matched);
  assert.match(result.report, /has no earlier \$id in this fixture/);
});

test("compare() genuinely deep-compares a real executed dict's printed contents (Bug 5 fixture-level proof), passing on a match and failing on a deliberately corrupted expectation", () => {
  const { events, diagnostics } = produce(
    ":d = { tom: 8 sophie: 6 }\nprint :d",
    "dict-contents-fixture-check",
    true,
  );
  assert.equal(diagnostics.length, 0);
  assert.ok(events.some((event) => event.kind === "print"));

  const withPrintPayload = (values) => (event) =>
    event.kind === "print" ? { ...event, payload: { values } } : event;

  const correctExpected = {
    events: events.map(withPrintPayload([{ tom: 8, sophie: 6 }])),
    diagnostics: [],
  };
  const passResult = compare(correctExpected, { events, diagnostics });
  assert.ok(passResult.matched, passResult.report);

  // Deliberately corrupt the expected dict contents: this must now genuinely fail.
  const corruptedExpected = {
    events: events.map(withPrintPayload([{ tom: 8, sophie: 999 }])),
    diagnostics: [],
  };
  const failResult = compare(corruptedExpected, { events, diagnostics });
  assert.ok(!failResult.matched);
  assert.match(failResult.report, /event mismatch/);
});

test("compare() genuinely deep-compares a real executed record's printed contents (Bug 5 fixture-level proof), passing on a match and failing on a deliberately corrupted expectation", () => {
  const { events, diagnostics } = produce(
    "struct point [ x y ]\nprint point 3 4",
    "record-contents-fixture-check",
    true,
  );
  assert.equal(diagnostics.length, 0);
  assert.ok(events.some((event) => event.kind === "print"));

  const withPrintPayload = (values) => (event) =>
    event.kind === "print" ? { ...event, payload: { values } } : event;

  const correctExpected = {
    events: events.map(withPrintPayload([{ x: 3, y: 4 }])),
    diagnostics: [],
  };
  const passResult = compare(correctExpected, { events, diagnostics });
  assert.ok(passResult.matched, passResult.report);

  // Deliberately corrupt the expected record contents: this must now genuinely fail.
  const corruptedExpected = {
    events: events.map(withPrintPayload([{ x: 3, y: 999 }])),
    diagnostics: [],
  };
  const failResult = compare(corruptedExpected, { events, diagnostics });
  assert.ok(!failResult.matched);
  assert.match(failResult.report, /event mismatch/);
});

test("compare() with the __type opt-in genuinely distinguishes a real executed record's struct type, not just its field contents (Bug 5 follow-up: rubber-duck-reported gap)", () => {
  const { events, diagnostics } = produce(
    "struct point [ x y ]\nstruct vector [ x y ]\nprint point 3 4\nprint vector 3 4",
    "record-type-fixture-check",
    true,
  );
  assert.equal(diagnostics.length, 0);
  const printEvents = events.filter((event) => event.kind === "print");
  assert.equal(printEvents.length, 2);

  const withPrintPayloads = (payloads) => {
    let index = 0;
    return (event) =>
      event.kind === "print"
        ? { ...event, payload: { values: payloads[index++] } }
        : event;
  };

  // Correct expectation: each record's declared struct type is asserted via "__type" and matches.
  const correctExpected = {
    events: events.map(
      withPrintPayloads([
        [{ __type: "point", x: 3, y: 4 }],
        [{ __type: "vector", x: 3, y: 4 }],
      ]),
    ),
    diagnostics: [],
  };
  const passResult = compare(correctExpected, { events, diagnostics });
  assert.ok(passResult.matched, passResult.report);

  // Swap the expected "__type" labels: identical field contents, but the WRONG struct type at
  // each position — this is exactly the gap a type-less expected shape could never catch, and
  // must now genuinely fail rather than silently pass.
  const swappedExpected = {
    events: events.map(
      withPrintPayloads([
        [{ __type: "vector", x: 3, y: 4 }],
        [{ __type: "point", x: 3, y: 4 }],
      ]),
    ),
    diagnostics: [],
  };
  const failResult = compare(swappedExpected, { events, diagnostics });
  assert.ok(!failResult.matched);
  assert.match(failResult.report, /event mismatch/);
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
          // message is optional in a FIXTURE: the harness compares identity, not prose
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
});

test("loadFixture handles invalid JSON", () => {
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
});

test("loadFixture validates expect field", () => {
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
});

test("loadFixture defaults execute to false when absent", () => {
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
});

test("loadFixture reads an explicit execute: true opt-in", () => {
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
});

// --- issue #1025: the `compareMessages` opt-in, and why both directions are errors --------------

/** Write a throwaway fixture pair under TEMP_ROOT and load it. */
function loadTempFixture(name, spec, source = "") {
  mkdirSync(join(TEMP_ROOT, name), { recursive: true });
  writeFileSync(join(TEMP_ROOT, name, `${name}.logo`), source);
  writeFileSync(
    join(TEMP_ROOT, name, `${name}.expected.json`),
    JSON.stringify(spec),
  );
  return loadFixture({
    name: `${name}/${name}.expected.json`,
    expectedPath: join(TEMP_ROOT, name, `${name}.expected.json`),
    logoPath: join(TEMP_ROOT, name, `${name}.logo`),
  });
}

/** A minimal well-formed expected diagnostic, plus whatever `extra` keys a test needs. */
function tempDiagnostic(extra = {}) {
  return {
    code: "ol-bad-token",
    source_span: { document: "t", start: [1, 1], end: [1, 2] },
    params: {},
    stage: "parse",
    severity: "error",
    ...extra,
  };
}

test("loadFixture rejects a `message` on a fixture that did not set compareMessages, so nothing can be present-but-ignored again (issue #1025)", () => {
  // This is AC-A3 turned from a one-time cleanup into a structural property. Before #1025 the
  // corpus carried 306 message fields that the harness silently dropped — data that reads as
  // evidence and is not. Deleting them once would have fixed the corpus and not the hole.
  const loaded = loadTempFixture("message-without-optin", {
    profiles: ["core-language"],
    events: [],
    diagnostics: [tempDiagnostic({ message: "asserted by nothing" })],
  });

  assert.ok(loaded.error);
  assert.ok(loaded.error.includes("compareMessages"));
  assert.ok(loaded.error.includes("delete the message"));
});

test("loadFixture rejects compareMessages: true when no expected diagnostic carries a message (issue #1025)", () => {
  // The other direction: an opt-in that asserts nothing is a fixture-author mistake, not a no-op —
  // the same reason `executeOptions` without `"execute": true` is rejected rather than ignored.
  const loaded = loadTempFixture("optin-without-message", {
    profiles: ["core-language"],
    compareMessages: true,
    events: [],
    diagnostics: [tempDiagnostic()],
  });

  assert.ok(loaded.error);
  assert.ok(loaded.error.includes("no expected diagnostic carries"));
});

test('loadFixture rejects a non-string or empty message, so neither `null` nor `""` can opt in and then fail at compare time (@testing R2-F3 / R3-F2 on issue #1025)', () => {
  // `Object.hasOwn` decides the per-diagnostic opt-in, so `"message": null` would otherwise count
  // as opting in and fail later against a diff instead of naming the fixture's own mistake. `""`
  // goes the same way for the same reason: `validateDiagnostics` makes every produced message
  // truthy, so an empty expectation can never match.
  for (const [index, message] of [null, "", 42, true, ["a"]].entries()) {
    const loaded = loadTempFixture(`bad-message-${index}`, {
      profiles: ["core-language"],
      compareMessages: true,
      diagnostics: [tempDiagnostic({ message })],
      events: [],
    });

    assert.ok(
      loaded.error,
      `message ${JSON.stringify(message)} must be rejected`,
    );
    assert.ok(loaded.error.includes('non-string or empty "message"'));
  }
});

test("loadFixture rejects a non-boolean compareMessages field", () => {
  const loaded = loadTempFixture("bad-compare-messages", {
    profiles: ["core-language"],
    compareMessages: "yes",
    events: [],
    diagnostics: [],
  });

  assert.ok(loaded.error);
  assert.ok(loaded.error.includes('"compareMessages" must be a boolean'));
});

test("loadFixture accepts a fixture that opts in and carries a message, defaulting the flag to false otherwise", () => {
  const optedIn = loadTempFixture("with-compare-messages", {
    profiles: ["core-language"],
    compareMessages: true,
    events: [],
    diagnostics: [tempDiagnostic({ message: "asserted on purpose" })],
  });
  assert.equal(optedIn.expected.compareMessages, true);

  const plain = loadTempFixture("without-compare-messages", {
    profiles: ["core-language"],
    events: [],
    diagnostics: [tempDiagnostic()],
  });
  assert.equal(plain.expected.compareMessages, false);
});

test("loadFixture rejects an unknown key on an expected diagnostic, so a misspelled `message` cannot assert nothing (@testing F1 on issue #1025)", () => {
  // Now that `message` is load-bearing, `mesage`/`Message`/`msg` would buy exactly the defect
  // #1025 exists to kill, one level down: a field that reads as evidence and is silently dropped.
  // Same allow-list reflex as validateExecuteOptions and ALLOWED_HOST_INPUT_KEYS.
  const loaded = loadTempFixture("typo-message-key", {
    profiles: ["core-language"],
    compareMessages: true,
    events: [],
    diagnostics: [
      tempDiagnostic({ message: "real", mesage: "TOTALLY WRONG PROSE" }),
    ],
  });

  assert.ok(loaded.error);
  assert.ok(loaded.error.includes('unknown key "mesage"'));

  // The control: the correctly-spelled key on the same fixture loads clean, so the rejection is
  // about the spelling and not about the fixture shape.
  const control = loadTempFixture("typo-message-key-control", {
    profiles: ["core-language"],
    compareMessages: true,
    events: [],
    diagnostics: [tempDiagnostic({ message: "real" })],
  });
  assert.equal(control.error, undefined);
});

// --- issue #1028: `expect: "mismatch"` may not neutralise the opt-in ---------------------------

/**
 * The one source these probes use, and the reason they isolate MESSAGE comparison rather than
 * anything else: under `"check": true` it produces exactly one `ol-reserved-word` diagnostic, whose
 * every field except the prose is pinned identically by {@link wrongMessageOptedInSpec}. It is the
 * source `_harness-selftest/detects-message-mismatch` itself uses.
 */
const RESERVED_WORD_SOURCE = "define forward :n\n  print :n\nend\n";

/**
 * A fixture that opts into message comparison and is wrong in EXACTLY ONE way: its expected
 * `ol-reserved-word` sentence is the wording issues #751/#871 shipped, which
 * `spec/error-model.md:125` forbids (it leaks the word *primitive* at a learner). Identity — code,
 * span, params, stage, severity — matches what `check()` really produces, so the only thing that
 * can make the streams disagree is the message.
 *
 * Under `expect: "match"` that is a failure naming the offending prose. Under `expect: "mismatch"`
 * the inverted verdict turned it into a PASS: the hole #1028 closes.
 *
 * `document` is the fixture's own name minus the suffix, which is what the harness passes the
 * parser — so two fixtures with the same name under different roots are byte-identical apart from
 * the one field under test.
 */
function wrongMessageOptedInSpec(expectPolarity, document) {
  return {
    description: "issue #1028 probe fixture",
    expect: expectPolarity,
    compareMessages: true,
    check: true,
    profiles: ["core-language"],
    events: [],
    diagnostics: [
      {
        code: "ol-reserved-word",
        source_span: { document, start: [1, 8], end: [1, 15] },
        params: { name: "forward" },
        message:
          "forward is already a reserved primitive, so it can't be redefined here.",
        stage: "semantic",
        severity: "error",
      },
    ],
  };
}

/**
 * Write one fixture pair at `name` — a `/`-separated fixture path relative to `root`, so a test can
 * place a fixture INSIDE `_harness-selftest/`, which `loadTempFixture` above cannot express — and
 * return the descriptor `loadFixture`/`runHarness` would see for it. Returning the descriptor is
 * what lets the polarity twins below carry the SAME name under different roots, so nothing but
 * `expect` differs between them.
 */
function placeFixture(root, name, spec, source = RESERVED_WORD_SOURCE) {
  const segments = name.split("/");
  const stem = segments.at(-1);
  const directory = join(root, ...segments);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, `${stem}.logo`), source);
  writeFileSync(join(directory, `${stem}.expected.json`), JSON.stringify(spec));
  return {
    name: `${name}/${stem}${EXPECTED_SUFFIX}`,
    expectedPath: join(directory, `${stem}${EXPECTED_SUFFIX}`),
    logoPath: join(directory, `${stem}.logo`),
  };
}

/**
 * The fixture name both polarity twins carry, and the `document` the harness therefore hands the
 * parser for them (`<name>/<stem>`, the fixture name minus its suffix). Defined once because the
 * isolation block in the run-level test has to reconstruct the same `document` to call `produce()`
 * directly — two literals that must agree is one literal too many.
 */
const POLARITY_PROBE_NAME = "polarity-probe";
const POLARITY_PROBE_DOCUMENT = `${POLARITY_PROBE_NAME}/${POLARITY_PROBE_NAME}`;

/** Both twins, written under sibling roots with one identical fixture name and path. */
function placePolarityTwin(polarity, name = POLARITY_PROBE_NAME) {
  const root = join(TEMP_ROOT, `arm-${polarity}`);
  return {
    root,
    fixture: placeFixture(
      root,
      name,
      wrongMessageOptedInSpec(polarity, `${name}/${name}`),
    ),
  };
}

/**
 * Run the harness over one root and return its exit code together with everything it printed.
 * Both arms of the #1028 control now exit 1, so the exit code alone cannot tell "rejected as a
 * fixture error" apart from "ran and mismatched" — the output is what makes the pair meaningful.
 */
function runHarnessCapturingOutput(options) {
  const lines = [];
  const originalLog = console.log;
  console.log = (...args) => lines.push(args.join(" "));
  try {
    return { exitCode: runHarness(options), output: lines.join("\n") };
  } finally {
    console.log = originalLog;
  }
}

test('loadFixture rejects `expect: "mismatch"` on a fixture that opted into message comparison, naming both fields (issue #1028)', () => {
  // Measured on `4ad13363`: such a fixture — identical to what `check()` produces except for one
  // wrong sentence — reported `1 passed, 0 failed`, while the twin differing only in polarity
  // failed on that sentence. The third way to hold a `message` that is not guaranteed to assert
  // anything, and the one #1025's two directions left open.
  const neutralised = loadFixture(placePolarityTwin("mismatch").fixture);

  assert.ok(neutralised.error);
  assert.ok(neutralised.error.includes('"compareMessages": true'));
  assert.ok(neutralised.error.includes('"expect": "mismatch"'));

  // The control: the twin differing in NOTHING but polarity — same fixture name, same document,
  // same bytes otherwise, under a sibling root — loads clean. So the rejection is about the
  // combination and not about anything else in the fixture.
  const control = loadFixture(placePolarityTwin("match").fixture);
  assert.equal(control.error, undefined);
  assert.equal(control.expected.compareMessages, true);
  assert.equal(control.expected.expect, "match");
});

test('runHarness fails a fixture combining compareMessages with expect: "mismatch", where it used to pass — with the expect: "match" twin as the positive control (issue #1028)', () => {
  // Reproduces the measurement taken on `4ad13363`, where these two arms exited 0 and 1 — the
  // mismatch arm passing on the very disagreement its opt-in was supposed to fail on, the match arm
  // failing on that prose. Inverted polarity is satisfied by any disagreement at all, so an opted-in
  // fixture's verdict is no longer guaranteed to rest on the message it opted in to pin.
  //
  // The control is what makes the first arm mean anything: without it, a harness broken for every
  // fixture would satisfy the new rejection just as well as a working one. Each arm gets its own
  // root so its exit code is attributable to its own single fixture, and both fixtures are named
  // identically so `expect` is the only difference between them.
  const neutralisedTwin = placePolarityTwin("mismatch");
  const neutralised = runHarnessCapturingOutput({ root: neutralisedTwin.root });

  assert.equal(
    neutralised.exitCode,
    1,
    "the fixture that used to pass by inverting its own assertion must now fail",
  );
  assert.match(neutralised.output, /0 passed, 1 failed/);
  assert.ok(neutralised.output.includes('"compareMessages": true'));
  assert.ok(neutralised.output.includes('"expect": "mismatch"'));

  // The positive control: the twin under `expect: "match"` runs and fails on the MESSAGE alone —
  // every other field agrees with what `check()` produced, so this is the comparison the opt-in
  // exists for, firing. That is what the mismatch arm was cancelling.
  const control = runHarnessCapturingOutput({
    root: placePolarityTwin("match").root,
  });

  assert.equal(control.exitCode, 1);
  assert.ok(control.output.includes("diagnostic mismatch"));

  // …and the reason is isolated MECHANICALLY rather than read off the report: `diffStream` prints
  // the whole expected diagnostic for a mismatch in ANY field, so finding the offending prose in
  // the output would not by itself prove the prose was the cause. Running the same expected stream
  // against the same produced one with message comparison switched OFF matches, so identity, span,
  // stage, severity and events all agree — leaving the sentence as the only possible difference.
  const document = POLARITY_PROBE_DOCUMENT;
  const produced = produce(
    RESERVED_WORD_SOURCE,
    document,
    false,
    true,
    ["core-language"],
    false,
    undefined,
  );
  const specification = wrongMessageOptedInSpec("match", document);
  assert.ok(
    compare({ ...specification, compareMessages: false }, produced).matched,
    "with prose excluded the two streams must agree, or the control is failing on something other than the message",
  );
  assert.ok(
    !compare(specification, produced).matched,
    "with prose included they must disagree — that difference is the whole subject of the opt-in",
  );
});

test("runHarness still runs `_harness-selftest/detects-message-mismatch`, the one fixture that needs the combination to prove the comparison fires (issue #1028)", () => {
  // The exemption is not a courtesy: this self-test demonstrates a DETECTION, and a detection can
  // only be demonstrated by expecting it.
  const root = join(TEMP_ROOT, "arm-allowed-selftest");
  const name = "_harness-selftest/detects-message-mismatch";
  placeFixture(
    root,
    name,
    wrongMessageOptedInSpec("mismatch", `${name}/${name.split("/").at(-1)}`),
  );
  const selfTest = runHarnessCapturingOutput({ root });

  assert.equal(selfTest.exitCode, 0);
  assert.ok(selfTest.output.includes("self-test: mismatch correctly detected"));
});

test("runHarness rejects ANOTHER self-test that combines the two fields, because being a self-test does not imply needing them (issue #1028)", () => {
  // The exemption is one named fixture, not the whole `_harness-selftest/` tree, and this is why:
  // `tests/conformance/README.md` already tells fixture authors "do not combine `expect:
  // "mismatch"` with a `message` anywhere else", because a self-test that exists to prove some
  // OTHER mismatch is detected would be able to pass on prose while its real subject regressed.
  // A prefix-wide exemption would have enforced something looser than the documented rule.
  const root = join(TEMP_ROOT, "arm-other-selftest");
  const name = "_harness-selftest/detects-execution-mismatch";
  placeFixture(
    root,
    name,
    wrongMessageOptedInSpec("mismatch", `${name}/${name.split("/").at(-1)}`),
  );
  const other = runHarnessCapturingOutput({ root });

  assert.equal(other.exitCode, 1);
  assert.ok(other.output.includes('"compareMessages": true'));
  assert.ok(other.output.includes('"expect": "mismatch"'));
});

test("runHarness rejects a SECOND fixture sited inside the allowed self-test's own directory, because the exemption is one fixture and not a directory (issue #1028)", () => {
  // The allowlist is a complete fixture name compared by equality, not a prefix. A directory test
  // would let anything sited beside `detects-message-mismatch` inherit its exemption, which is not
  // what "one fixture" means — and a neighbour is the easiest place to put such a fixture by
  // accident, since it is the one directory where the combination is known to be legal.
  const root = join(TEMP_ROOT, "arm-selftest-neighbour");
  const name = "_harness-selftest/detects-message-mismatch/a-neighbour";
  placeFixture(
    root,
    name,
    wrongMessageOptedInSpec("mismatch", `${name}/${name.split("/").at(-1)}`),
  );
  const neighbour = runHarnessCapturingOutput({ root });

  assert.equal(neighbour.exitCode, 1);
  assert.ok(neighbour.output.includes('"compareMessages": true'));
  assert.ok(neighbour.output.includes('"expect": "mismatch"'));
});

test("loadFixture rejects a non-boolean execute field", () => {
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
});

test("loadFixture defaults check to false when absent", () => {
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
});

test("loadFixture reads an explicit check: true opt-in", () => {
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
});

test("loadFixture rejects a non-boolean check field", () => {
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
});

test("loadFixture defaults style to false when not present", () => {
  mkdirSync(join(TEMP_ROOT, "no-style"), { recursive: true });
  writeFileSync(join(TEMP_ROOT, "no-style", "no-style.logo"), "print 1");
  writeFileSync(
    join(TEMP_ROOT, "no-style", "no-style.expected.json"),
    JSON.stringify({
      profiles: ["core-language"],
      check: true,
      events: [],
      diagnostics: [],
    }),
  );

  const loaded = loadFixture({
    name: "no-style/no-style.expected.json",
    expectedPath: join(TEMP_ROOT, "no-style", "no-style.expected.json"),
    logoPath: join(TEMP_ROOT, "no-style", "no-style.logo"),
  });

  assert.equal(loaded.expected.style, false);
});

test("loadFixture reads an explicit style: true opt-in", () => {
  mkdirSync(join(TEMP_ROOT, "with-style"), { recursive: true });
  writeFileSync(join(TEMP_ROOT, "with-style", "with-style.logo"), "print 1");
  writeFileSync(
    join(TEMP_ROOT, "with-style", "with-style.expected.json"),
    JSON.stringify({
      profiles: ["core-language"],
      check: true,
      style: true,
      events: [],
      diagnostics: [],
    }),
  );

  const loaded = loadFixture({
    name: "with-style/with-style.expected.json",
    expectedPath: join(TEMP_ROOT, "with-style", "with-style.expected.json"),
    logoPath: join(TEMP_ROOT, "with-style", "with-style.logo"),
  });

  assert.equal(loaded.expected.style, true);
});

test("loadFixture rejects a non-boolean style field", () => {
  mkdirSync(join(TEMP_ROOT, "bad-style"), { recursive: true });
  writeFileSync(join(TEMP_ROOT, "bad-style", "bad-style.logo"), "");
  writeFileSync(
    join(TEMP_ROOT, "bad-style", "bad-style.expected.json"),
    JSON.stringify({
      profiles: ["core-language"],
      check: true,
      style: "yes",
      events: [],
      diagnostics: [],
    }),
  );

  const loaded = loadFixture({
    name: "bad-style/bad-style.expected.json",
    expectedPath: join(TEMP_ROOT, "bad-style", "bad-style.expected.json"),
    logoPath: join(TEMP_ROOT, "bad-style", "bad-style.logo"),
  });

  assert.ok(loaded.error);
  assert.ok(loaded.error.includes('"style" must be a boolean'));
});

test("loadFixture leaves executeOptions undefined when not present", () => {
  mkdirSync(join(TEMP_ROOT, "no-execute-options"), { recursive: true });
  writeFileSync(
    join(TEMP_ROOT, "no-execute-options", "no-execute-options.logo"),
    "print 1",
  );
  writeFileSync(
    join(TEMP_ROOT, "no-execute-options", "no-execute-options.expected.json"),
    JSON.stringify({
      profiles: ["core-language"],
      execute: true,
      events: [],
      diagnostics: [],
    }),
  );

  const loaded = loadFixture({
    name: "no-execute-options/no-execute-options.expected.json",
    expectedPath: join(
      TEMP_ROOT,
      "no-execute-options",
      "no-execute-options.expected.json",
    ),
    logoPath: join(TEMP_ROOT, "no-execute-options", "no-execute-options.logo"),
  });

  assert.equal(loaded.expected.executeOptions, undefined);
});

test("loadFixture rejects executeOptions when execute is not true (silently-ignored config would mask a fixture-author typo)", () => {
  mkdirSync(join(TEMP_ROOT, "execute-options-without-execute"), {
    recursive: true,
  });
  writeFileSync(
    join(
      TEMP_ROOT,
      "execute-options-without-execute",
      "execute-options-without-execute.logo",
    ),
    "print 1",
  );
  writeFileSync(
    join(
      TEMP_ROOT,
      "execute-options-without-execute",
      "execute-options-without-execute.expected.json",
    ),
    JSON.stringify({
      profiles: ["core-language"],
      executeOptions: { instructionBudget: 5 },
      events: [],
      diagnostics: [],
    }),
  );

  const loaded = loadFixture({
    name: "execute-options-without-execute/execute-options-without-execute.expected.json",
    expectedPath: join(
      TEMP_ROOT,
      "execute-options-without-execute",
      "execute-options-without-execute.expected.json",
    ),
    logoPath: join(
      TEMP_ROOT,
      "execute-options-without-execute",
      "execute-options-without-execute.logo",
    ),
  });

  assert.ok(loaded.error);
  assert.ok(loaded.error.includes('"executeOptions" requires "execute": true'));
});

test("loadFixture rejects executeOptions when execute is explicitly false", () => {
  mkdirSync(join(TEMP_ROOT, "execute-options-execute-false"), {
    recursive: true,
  });
  writeFileSync(
    join(
      TEMP_ROOT,
      "execute-options-execute-false",
      "execute-options-execute-false.logo",
    ),
    "print 1",
  );
  writeFileSync(
    join(
      TEMP_ROOT,
      "execute-options-execute-false",
      "execute-options-execute-false.expected.json",
    ),
    JSON.stringify({
      profiles: ["core-language"],
      execute: false,
      executeOptions: { instructionBudget: 5 },
      events: [],
      diagnostics: [],
    }),
  );

  const loaded = loadFixture({
    name: "execute-options-execute-false/execute-options-execute-false.expected.json",
    expectedPath: join(
      TEMP_ROOT,
      "execute-options-execute-false",
      "execute-options-execute-false.expected.json",
    ),
    logoPath: join(
      TEMP_ROOT,
      "execute-options-execute-false",
      "execute-options-execute-false.logo",
    ),
  });

  assert.ok(loaded.error);
  assert.ok(loaded.error.includes('"executeOptions" requires "execute": true'));
});

test("loadFixture rejects executeOptions when check is true alongside execute:true (check short-circuits produce() before execute() ever runs)", () => {
  mkdirSync(join(TEMP_ROOT, "execute-options-with-check-true"), {
    recursive: true,
  });
  writeFileSync(
    join(
      TEMP_ROOT,
      "execute-options-with-check-true",
      "execute-options-with-check-true.logo",
    ),
    "print 1",
  );
  writeFileSync(
    join(
      TEMP_ROOT,
      "execute-options-with-check-true",
      "execute-options-with-check-true.expected.json",
    ),
    JSON.stringify({
      profiles: ["core-language"],
      execute: true,
      check: true,
      executeOptions: { instructionBudget: 5 },
      events: [],
      diagnostics: [],
    }),
  );

  const loaded = loadFixture({
    name: "execute-options-with-check-true/execute-options-with-check-true.expected.json",
    expectedPath: join(
      TEMP_ROOT,
      "execute-options-with-check-true",
      "execute-options-with-check-true.expected.json",
    ),
    logoPath: join(
      TEMP_ROOT,
      "execute-options-with-check-true",
      "execute-options-with-check-true.logo",
    ),
  });

  assert.ok(loaded.error);
  assert.ok(loaded.error.includes('"executeOptions" requires "execute": true'));
});

test("loadFixture reads an executeOptions object with instructionBudget/recursionDepthLimit/signal", () => {
  mkdirSync(join(TEMP_ROOT, "with-execute-options"), { recursive: true });
  writeFileSync(
    join(TEMP_ROOT, "with-execute-options", "with-execute-options.logo"),
    "print 1",
  );
  writeFileSync(
    join(
      TEMP_ROOT,
      "with-execute-options",
      "with-execute-options.expected.json",
    ),
    JSON.stringify({
      profiles: ["core-language"],
      execute: true,
      executeOptions: {
        instructionBudget: 5,
        recursionDepthLimit: 10,
        signal: { aborted: true },
      },
      events: [],
      diagnostics: [],
    }),
  );

  const loaded = loadFixture({
    name: "with-execute-options/with-execute-options.expected.json",
    expectedPath: join(
      TEMP_ROOT,
      "with-execute-options",
      "with-execute-options.expected.json",
    ),
    logoPath: join(
      TEMP_ROOT,
      "with-execute-options",
      "with-execute-options.logo",
    ),
  });

  assert.deepEqual(loaded.expected.executeOptions, {
    instructionBudget: 5,
    recursionDepthLimit: 10,
    signal: { aborted: true },
  });
});

test("loadFixture rejects a non-object executeOptions field", () => {
  mkdirSync(join(TEMP_ROOT, "bad-execute-options-type"), { recursive: true });
  writeFileSync(
    join(
      TEMP_ROOT,
      "bad-execute-options-type",
      "bad-execute-options-type.logo",
    ),
    "",
  );
  writeFileSync(
    join(
      TEMP_ROOT,
      "bad-execute-options-type",
      "bad-execute-options-type.expected.json",
    ),
    JSON.stringify({
      profiles: ["core-language"],
      execute: true,
      executeOptions: "nope",
      events: [],
      diagnostics: [],
    }),
  );

  const loaded = loadFixture({
    name: "bad-execute-options-type/bad-execute-options-type.expected.json",
    expectedPath: join(
      TEMP_ROOT,
      "bad-execute-options-type",
      "bad-execute-options-type.expected.json",
    ),
    logoPath: join(
      TEMP_ROOT,
      "bad-execute-options-type",
      "bad-execute-options-type.logo",
    ),
  });

  assert.ok(loaded.error);
  assert.ok(loaded.error.includes('"executeOptions" must be an object'));
});

test("loadFixture rejects an array executeOptions field", () => {
  mkdirSync(join(TEMP_ROOT, "bad-execute-options-array"), {
    recursive: true,
  });
  writeFileSync(
    join(
      TEMP_ROOT,
      "bad-execute-options-array",
      "bad-execute-options-array.logo",
    ),
    "",
  );
  writeFileSync(
    join(
      TEMP_ROOT,
      "bad-execute-options-array",
      "bad-execute-options-array.expected.json",
    ),
    JSON.stringify({
      profiles: ["core-language"],
      execute: true,
      executeOptions: [],
      events: [],
      diagnostics: [],
    }),
  );

  const loaded = loadFixture({
    name: "bad-execute-options-array/bad-execute-options-array.expected.json",
    expectedPath: join(
      TEMP_ROOT,
      "bad-execute-options-array",
      "bad-execute-options-array.expected.json",
    ),
    logoPath: join(
      TEMP_ROOT,
      "bad-execute-options-array",
      "bad-execute-options-array.logo",
    ),
  });

  assert.ok(loaded.error);
  assert.ok(loaded.error.includes('"executeOptions" must be an object'));
});

test("loadFixture rejects a non-numeric executeOptions.instructionBudget", () => {
  mkdirSync(join(TEMP_ROOT, "bad-instruction-budget"), { recursive: true });
  writeFileSync(
    join(TEMP_ROOT, "bad-instruction-budget", "bad-instruction-budget.logo"),
    "",
  );
  writeFileSync(
    join(
      TEMP_ROOT,
      "bad-instruction-budget",
      "bad-instruction-budget.expected.json",
    ),
    JSON.stringify({
      profiles: ["core-language"],
      execute: true,
      executeOptions: { instructionBudget: "five" },
      events: [],
      diagnostics: [],
    }),
  );

  const loaded = loadFixture({
    name: "bad-instruction-budget/bad-instruction-budget.expected.json",
    expectedPath: join(
      TEMP_ROOT,
      "bad-instruction-budget",
      "bad-instruction-budget.expected.json",
    ),
    logoPath: join(
      TEMP_ROOT,
      "bad-instruction-budget",
      "bad-instruction-budget.logo",
    ),
  });

  assert.ok(loaded.error);
  assert.ok(
    loaded.error.includes(
      '"executeOptions.instructionBudget" must be a number',
    ),
  );
});

test("loadFixture rejects a non-numeric executeOptions.recursionDepthLimit", () => {
  mkdirSync(join(TEMP_ROOT, "bad-recursion-depth"), { recursive: true });
  writeFileSync(
    join(TEMP_ROOT, "bad-recursion-depth", "bad-recursion-depth.logo"),
    "",
  );
  writeFileSync(
    join(TEMP_ROOT, "bad-recursion-depth", "bad-recursion-depth.expected.json"),
    JSON.stringify({
      profiles: ["core-language"],
      execute: true,
      executeOptions: { recursionDepthLimit: "ten" },
      events: [],
      diagnostics: [],
    }),
  );

  const loaded = loadFixture({
    name: "bad-recursion-depth/bad-recursion-depth.expected.json",
    expectedPath: join(
      TEMP_ROOT,
      "bad-recursion-depth",
      "bad-recursion-depth.expected.json",
    ),
    logoPath: join(
      TEMP_ROOT,
      "bad-recursion-depth",
      "bad-recursion-depth.logo",
    ),
  });

  assert.ok(loaded.error);
  assert.ok(
    loaded.error.includes(
      '"executeOptions.recursionDepthLimit" must be a number',
    ),
  );
});

test("loadFixture rejects an executeOptions.signal missing a boolean aborted", () => {
  mkdirSync(join(TEMP_ROOT, "bad-signal"), { recursive: true });
  writeFileSync(join(TEMP_ROOT, "bad-signal", "bad-signal.logo"), "");
  writeFileSync(
    join(TEMP_ROOT, "bad-signal", "bad-signal.expected.json"),
    JSON.stringify({
      profiles: ["core-language"],
      execute: true,
      executeOptions: { signal: { aborted: "yes" } },
      events: [],
      diagnostics: [],
    }),
  );

  const loaded = loadFixture({
    name: "bad-signal/bad-signal.expected.json",
    expectedPath: join(TEMP_ROOT, "bad-signal", "bad-signal.expected.json"),
    logoPath: join(TEMP_ROOT, "bad-signal", "bad-signal.logo"),
  });

  assert.ok(loaded.error);
  assert.ok(
    loaded.error.includes(
      '"executeOptions.signal" must be an object with a boolean "aborted"',
    ),
  );
});

test("loadFixture reads an executeOptions.hostInput schedule of keys, clicks, and events", () => {
  mkdirSync(join(TEMP_ROOT, "good-host-input"), { recursive: true });
  writeFileSync(join(TEMP_ROOT, "good-host-input", "good-host-input.logo"), "");
  writeFileSync(
    join(TEMP_ROOT, "good-host-input", "good-host-input.expected.json"),
    JSON.stringify({
      profiles: ["core-language", "interaction-events"],
      execute: true,
      executeOptions: {
        hostInput: {
          events: [
            { tick: 1, kind: "key", key: "x" },
            { tick: 2, kind: "click" },
            { tick: 3, kind: "event", event: "go" },
          ],
        },
      },
      events: [],
      diagnostics: [],
    }),
  );

  const loaded = loadFixture({
    name: "good-host-input/good-host-input.expected.json",
    expectedPath: join(
      TEMP_ROOT,
      "good-host-input",
      "good-host-input.expected.json",
    ),
    logoPath: join(TEMP_ROOT, "good-host-input", "good-host-input.logo"),
  });

  assert.equal(loaded.error, undefined);
  assert.deepEqual(loaded.expected.executeOptions.hostInput.events, [
    { tick: 1, kind: "key", key: "x" },
    { tick: 2, kind: "click" },
    { tick: 3, kind: "event", event: "go" },
  ]);
});

test("loadFixture accepts a hostInput object that omits events (nothing to deliver)", () => {
  // A `hostInput` object with no `events` key is valid — it simply delivers nothing, the same as
  // omitting `hostInput` entirely. This is the shape an `input` fixture uses when it supplies only
  // scripted `responses` (issue #681, #657 ruling) and no tick-scheduled events.
  const loaded = loadHostInputFixture("host-input-no-events", {
    profiles: ["core-language"],
    execute: true,
    executeOptions: { hostInput: {} },
    events: [],
    diagnostics: [],
  });
  assert.equal(loaded.error, undefined);
  assert.deepEqual(loaded.expected.executeOptions.hostInput, {});
});

/**
 * Write a single-fixture directory whose `.expected.json` is `spec`, load it, and return the
 * `loadFixture` result — the shared shape for the executeOptions.hostInput rejection self-tests
 * below (issue #686, slice I7). Each asserts a specific malformed schedule is rejected at load time
 * rather than silently ignored by `execute()`, the typo-masking hole the harness closes.
 */
function loadHostInputFixture(name, spec) {
  mkdirSync(join(TEMP_ROOT, name), { recursive: true });
  writeFileSync(join(TEMP_ROOT, name, `${name}.logo`), "");
  writeFileSync(
    join(TEMP_ROOT, name, `${name}.expected.json`),
    JSON.stringify(spec),
  );
  return loadFixture({
    name: `${name}/${name}.expected.json`,
    expectedPath: join(TEMP_ROOT, name, `${name}.expected.json`),
    logoPath: join(TEMP_ROOT, name, `${name}.logo`),
  });
}

test("loadFixture rejects an unknown executeOptions key (closes the typo-masking hole for every future key)", () => {
  const loaded = loadHostInputFixture("unknown-execute-option", {
    profiles: ["core-language"],
    execute: true,
    // A typo of `hostInput`: it would load clean and be silently ignored by execute() without this.
    executeOptions: { hostInputs: [] },
    events: [],
    diagnostics: [],
  });
  assert.ok(loaded.error);
  assert.ok(
    loaded.error.includes(
      '"executeOptions.hostInputs" is not a JSON-expressible ExecuteOptions key',
    ),
  );
});

test("loadFixture rejects the function-typed tutorTemplates key (no JSON fixture can supply it)", () => {
  const loaded = loadHostInputFixture("tutor-templates-rejected", {
    profiles: ["core-language"],
    execute: true,
    // `tutorTemplates` is a function on ExecuteOptions — deliberately not JSON-expressible, so a
    // fixture naming it is a mistake and must be rejected, not silently forwarded as `undefined`.
    executeOptions: { tutorTemplates: [] },
    events: [],
    diagnostics: [],
  });
  assert.ok(loaded.error);
  assert.ok(
    loaded.error.includes(
      '"executeOptions.tutorTemplates" is not a JSON-expressible ExecuteOptions key',
    ),
  );
});

test("loadFixture accepts a string executeOptions.learnerLevel but rejects a non-string", () => {
  const good = loadHostInputFixture("learner-level-good", {
    profiles: ["core-language"],
    execute: true,
    executeOptions: { learnerLevel: "3" },
    events: [],
    diagnostics: [],
  });
  assert.equal(good.error, undefined);
  assert.equal(good.expected.executeOptions.learnerLevel, "3");

  const bad = loadHostInputFixture("learner-level-bad", {
    profiles: ["core-language"],
    execute: true,
    executeOptions: { learnerLevel: 3 },
    events: [],
    diagnostics: [],
  });
  assert.ok(bad.error);
  assert.ok(
    bad.error.includes('"executeOptions.learnerLevel" must be a string'),
  );
});

test("loadFixture rejects a non-object executeOptions.hostInput", () => {
  const loaded = loadHostInputFixture("host-input-not-object", {
    profiles: ["core-language"],
    execute: true,
    executeOptions: { hostInput: "nope" },
    events: [],
    diagnostics: [],
  });
  assert.ok(loaded.error);
  assert.ok(
    loaded.error.includes('"executeOptions.hostInput" must be an object'),
  );
});

test("loadFixture rejects an array executeOptions.hostInput (the old bare-array shape)", () => {
  // The pre-#657 shape was a bare array; after the reshape `hostInput` is an object, so an array
  // must be rejected rather than silently loaded — a fixture written to the old shape fails loudly.
  const loaded = loadHostInputFixture("host-input-bare-array", {
    profiles: ["core-language"],
    execute: true,
    executeOptions: { hostInput: [{ tick: 1, kind: "click" }] },
    events: [],
    diagnostics: [],
  });
  assert.ok(loaded.error);
  assert.ok(
    loaded.error.includes('"executeOptions.hostInput" must be an object'),
  );
});

test("loadFixture rejects an unknown key inside executeOptions.hostInput", () => {
  // A typo of `events` or `responses` must be rejected, naming the allowed keys, so a sub-key typo
  // cannot mask a delivery — or an answer — that never happens.
  const loaded = loadHostInputFixture("host-input-unknown-key", {
    profiles: ["core-language"],
    execute: true,
    executeOptions: { hostInput: { evetns: [] } },
    events: [],
    diagnostics: [],
  });
  assert.ok(loaded.error);
  assert.ok(
    loaded.error.includes(
      '"executeOptions.hostInput.evetns" is not a known hostInput key (known keys: events, responses)',
    ),
  );
});

test("loadFixture rejects a near-miss of `responses` rather than silently dropping the answers", () => {
  // The specific typo this slice introduces the risk of: `response` (singular) would load clean, be
  // ignored by execute(), and turn every `input` read into an unanswered one — a fixture that looks
  // like proof of the reader while proving only the cancellation path.
  const loaded = loadHostInputFixture("host-input-responses-typo", {
    profiles: ["core-language", "interaction-events"],
    execute: true,
    executeOptions: { hostInput: { response: ["tom"] } },
    events: [],
    diagnostics: [],
  });
  assert.ok(loaded.error);
  assert.ok(
    loaded.error.includes(
      '"executeOptions.hostInput.response" is not a known hostInput key (known keys: events, responses)',
    ),
  );
});

test("loadFixture rejects the function-typed hostInput.read key (no JSON fixture can supply a live reader)", () => {
  // Issue #681's live host reader is a function, exactly like `tutorTemplates` on `executeOptions`
  // itself. Rejecting it by name is what keeps `responses` the ONE fixture convention the #657
  // ruling fixed: a fixture cannot half-express an interactive host and quietly prove nothing.
  const loaded = loadHostInputFixture("host-input-read-rejected", {
    profiles: ["core-language", "interaction-events"],
    execute: true,
    executeOptions: { hostInput: { read: "not-a-function-in-json" } },
    events: [],
    diagnostics: [],
  });
  assert.ok(loaded.error);
  assert.ok(
    loaded.error.includes(
      '"executeOptions.hostInput.read" is not a known hostInput key (known keys: events, responses)',
    ),
  );
});

test("loadFixture reads an executeOptions.hostInput.responses queue of scripted input answers", () => {
  // The #657 ruling's one convention: `responses` sits beside `events` on the same `hostInput`
  // object (issue #681). Order is the FIFO each `input` call consumes.
  const loaded = loadHostInputFixture("host-input-responses", {
    profiles: ["core-language", "interaction-events"],
    execute: true,
    executeOptions: { hostInput: { responses: ["tom", "42"] } },
    events: [],
    diagnostics: [],
  });
  assert.equal(loaded.error, undefined);
  assert.deepEqual(loaded.expected.executeOptions.hostInput.responses, [
    "tom",
    "42",
  ]);
});

test("loadFixture accepts events and responses together on one hostInput object", () => {
  const loaded = loadHostInputFixture("host-input-both", {
    profiles: ["core-language", "interaction-events"],
    execute: true,
    executeOptions: {
      hostInput: {
        events: [{ tick: 1, kind: "click" }],
        responses: ["tom"],
      },
    },
    events: [],
    diagnostics: [],
  });
  assert.equal(loaded.error, undefined);
  assert.deepEqual(loaded.expected.executeOptions.hostInput, {
    events: [{ tick: 1, kind: "click" }],
    responses: ["tom"],
  });
});

test("loadFixture rejects a non-array executeOptions.hostInput.responses", () => {
  const loaded = loadHostInputFixture("host-input-responses-not-array", {
    profiles: ["core-language"],
    execute: true,
    executeOptions: { hostInput: { responses: "tom" } },
    events: [],
    diagnostics: [],
  });
  assert.ok(loaded.error);
  assert.ok(
    loaded.error.includes(
      '"executeOptions.hostInput.responses" must be an array',
    ),
  );
});

test("loadFixture rejects a non-string entry in executeOptions.hostInput.responses", () => {
  // The bare JSON number `42` is the tempting mistake: it would look like proof of the number branch
  // while skipping the very parse (`spec/interaction-events.md:196-197`) that branch is about. An
  // answer is the raw TEXT the learner typed, so it must be written `"42"`.
  const loaded = loadHostInputFixture("host-input-responses-not-string", {
    profiles: ["core-language"],
    execute: true,
    executeOptions: { hostInput: { responses: ["tom", 42] } },
    events: [],
    diagnostics: [],
  });
  assert.ok(loaded.error);
  assert.ok(
    loaded.error.includes(
      '"executeOptions.hostInput.responses[1]" must be a string',
    ),
  );
});

test("loadFixture rejects a non-array executeOptions.hostInput.events", () => {
  const loaded = loadHostInputFixture("host-input-events-not-array", {
    profiles: ["core-language"],
    execute: true,
    executeOptions: { hostInput: { events: "nope" } },
    events: [],
    diagnostics: [],
  });
  assert.ok(loaded.error);
  assert.ok(
    loaded.error.includes('"executeOptions.hostInput.events" must be an array'),
  );
});

test("loadFixture rejects a hostInput entry that is not an object", () => {
  const loaded = loadHostInputFixture("host-input-entry-not-object", {
    profiles: ["core-language"],
    execute: true,
    executeOptions: { hostInput: { events: [42] } },
    events: [],
    diagnostics: [],
  });
  assert.ok(loaded.error);
  assert.ok(
    loaded.error.includes(
      '"executeOptions.hostInput.events[0]" must be an object',
    ),
  );
});

test("loadFixture rejects a hostInput entry with a non-numeric tick", () => {
  const loaded = loadHostInputFixture("host-input-bad-tick", {
    profiles: ["core-language"],
    execute: true,
    executeOptions: { hostInput: { events: [{ tick: "1", kind: "click" }] } },
    events: [],
    diagnostics: [],
  });
  assert.ok(loaded.error);
  assert.ok(
    loaded.error.includes(
      '"executeOptions.hostInput.events[0]".tick must be a finite number',
    ),
  );
});

test("loadFixture rejects a hostInput entry with an unrecognized kind", () => {
  const loaded = loadHostInputFixture("host-input-bad-kind", {
    profiles: ["core-language"],
    execute: true,
    executeOptions: { hostInput: { events: [{ tick: 1, kind: "scroll" }] } },
    events: [],
    diagnostics: [],
  });
  assert.ok(loaded.error);
  assert.ok(
    loaded.error.includes(
      '"executeOptions.hostInput.events[0]".kind must be "key", "click", or "event"',
    ),
  );
});

test("loadFixture rejects a key hostInput entry missing its string key", () => {
  const loaded = loadHostInputFixture("host-input-key-missing", {
    profiles: ["core-language"],
    execute: true,
    executeOptions: { hostInput: { events: [{ tick: 1, kind: "key" }] } },
    events: [],
    diagnostics: [],
  });
  assert.ok(loaded.error);
  assert.ok(
    loaded.error.includes(
      '"executeOptions.hostInput.events[0]".key must be a string when kind is "key"',
    ),
  );
});

test("loadFixture rejects an event hostInput entry missing its string event", () => {
  const loaded = loadHostInputFixture("host-input-event-missing", {
    profiles: ["core-language"],
    execute: true,
    executeOptions: { hostInput: { events: [{ tick: 1, kind: "event" }] } },
    events: [],
    diagnostics: [],
  });
  assert.ok(loaded.error);
  assert.ok(
    loaded.error.includes(
      '"executeOptions.hostInput.events[0]".event must be a string when kind is "event"',
    ),
  );
});

test("loadFixture rejects a hostInput entry with an unexpected extra field for its kind", () => {
  const loaded = loadHostInputFixture("host-input-extra-field", {
    profiles: ["core-language"],
    execute: true,
    // A `click` carrying a stray `key` — a typo that would otherwise mask an unintended delivery.
    executeOptions: {
      hostInput: { events: [{ tick: 1, kind: "click", key: "x" }] },
    },
    events: [],
    diagnostics: [],
  });
  assert.ok(loaded.error);
  assert.ok(
    loaded.error.includes(
      '"executeOptions.hostInput.events[0]" has an unexpected field "key" for kind "click"',
    ),
  );
});

test("produce forwards executeOptions to @openlogo/runtime's execute() so ol-limit can be triggered deterministically", () => {
  const result = produce(
    'forever [ print "x" ]',
    "test-doc",
    true,
    false,
    [],
    false,
    { instructionBudget: 3 },
  );
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-limit");
  assert.deepEqual(result.diagnostics[0].params, {
    limit: "instruction-budget",
    value: 3,
  });
});

test("produce forwards executeOptions.hostInput to execute() so a headless fixture can deliver input", () => {
  const result = produce(
    'on_key "x" [ print 1 ]\nwait 1',
    "test-doc",
    true,
    false,
    ["core-language", "interaction-events"],
    false,
    { hostInput: { events: [{ tick: 1, kind: "key", key: "x" }] } },
  );
  assert.deepEqual(result.diagnostics, []);
  const printed = result.events.filter((event) => event.kind === "print");
  assert.equal(printed.length, 1);
  assert.deepEqual(printed[0].payload.values, [1]);
});

test("produce forwards executeOptions.hostInput.responses to execute() so a headless fixture can answer a read", () => {
  // The other half of the same seam (issue #681): scripted answers reach `execute()` verbatim, so a
  // fixture's `input` read reports the value `spec/interaction-events.md:196-197` prescribes.
  const result = produce(
    'print input "q"',
    "test-doc",
    true,
    false,
    ["core-language", "interaction-events"],
    false,
    { hostInput: { responses: ["42"] } },
  );
  assert.deepEqual(result.diagnostics, []);
  const printed = result.events.filter((event) => event.kind === "print");
  assert.equal(printed.length, 1);
  // `"42"` parses as a number literal, so the read reports the NUMBER 42 — proof the answer really
  // travelled through and was classified, not merely echoed.
  assert.deepEqual(printed[0].payload.values, [42]);
});

test("loadFixture handles missing .expected.json file", () => {
  mkdirSync(join(TEMP_ROOT, "no-expected"), { recursive: true });
  writeFileSync(join(TEMP_ROOT, "no-expected", "test.logo"), "");

  const loaded = loadFixture({
    name: "no-expected/test.expected.json",
    expectedPath: join(TEMP_ROOT, "no-expected", "test.expected.json"),
    logoPath: join(TEMP_ROOT, "no-expected", "test.logo"),
  });

  assert.ok(loaded.error);
  assert.ok(loaded.error.includes("missing expected file"));
});

test("loadFixture handles missing .logo file", () => {
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
  // TEMP_ROOT is a fresh, empty directory from beforeEach — nothing to run.
  const exitCode = runHarness({ root: TEMP_ROOT });
  assert.equal(exitCode, 0); // No fixtures = success (nothing to fail)
});

test("runHarness handles fixture with load error", () => {
  // Create a fixture with bad JSON
  mkdirSync(join(TEMP_ROOT, "bad-json-load"), {
    recursive: true,
  });
  writeFileSync(join(TEMP_ROOT, "bad-json-load", "bad.logo"), "");
  writeFileSync(
    join(TEMP_ROOT, "bad-json-load", "bad.expected.json"),
    "{not valid json",
  );

  const exitCode = runHarness({ root: TEMP_ROOT });
  assert.equal(exitCode, 1); // Should fail
});

// Coverage-anchor tests (issue #173): `npm run coverage` (`node --test
// --experimental-test-coverage`) runs only `*.test.mjs` — it never runs `scripts/conformance.mjs`,
// so the real fixture corpus under `tests/conformance/` only reaches `@openlogo/runtime`'s (or any
// other package's) code coverage measurement via a `*.test.mjs` that executes it. These two tests
// are that deliberate, intentional bridge: both are READ-ONLY (they never write into
// `tests/conformance/`, so — unlike the tests above, which is why they get their own mkdtemp
// `TEMP_ROOT` — they carry none of the #140 fixture-write race) and both call `runHarness()` with
// no `root`, which defaults to the real corpus.
//
// As of this issue, an audit (temporarily `.skip`-ing both tests and re-running `npm run coverage`)
// confirmed neither test is *currently* load-bearing for any `packages/**/src` line/branch/function:
// the `for ... from ... to ... by` error-propagation branches these two used to cover only
// incidentally (surfaced by #140/#172) now have direct, deterministic unit tests of their own in
// `packages/runtime/src/for-loop-binders.test.mjs` (added by #97/#171/#174) that exercise
// `execute()` directly and do not depend on the corpus at all. That is the target end-state for
// every runtime slice (#173's "make each slice ship its own direct unit tests" direction) — the
// corpus should only ever be a cross-check, never the sole source of a coverage number.
//
// These two tests are kept anyway, for two reasons: (1) they are still useful, non-redundant
// **behavioral** tests of `runHarness()` itself (that it correctly discovers and passes the real,
// growing fixture tree, and that profile filtering narrows it correctly) — that behavior has no
// other test; (2) as defense-in-depth, so that if a *future* runtime/parser/core slice ships
// without its own direct unit test for some error-path only a corpus fixture happens to exercise,
// that path still counts toward the 100% gate instead of silently regressing main. If a future audit
// finds one of these two tests IS load-bearing for some `packages/**/src` path again, the fix is to
// add a direct unit test for that specific path (mirroring `for-loop-binders.test.mjs`'s pattern),
// not to keep leaning on this spillover.
test("runHarness exits 0 for passing fixtures (explicit real-corpus coverage anchor: read-only, executes the full corpus so any fixture-only package path still counts toward coverage)", () => {
  const exitCode = runHarness({});
  assert.equal(exitCode, 0);
});

test("runHarness exits 2 for unknown profile", () => {
  const exitCode = runHarness({ profile: "not-a-real-profile" });
  assert.equal(exitCode, 2);
});

test("runHarness filters fixtures by profile (also a read-only real-corpus coverage anchor, scoped to the core-language profile subset)", () => {
  const exitCode = runHarness({ profile: "core-language" });
  assert.equal(exitCode, 0);
});

test("runHarness detects fixture mismatches", () => {
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
  // at TEMP_ROOT won't be discovered. We need to test compare() directly instead:
  const expected = {
    profiles: ["core-language"],
    events: [],
    diagnostics: [{ code: "ol-bad-token" }],
  };
  const actual = produce("]", ["core-language"]);
  const result = compare(expected, actual);

  assert.ok(!result.matched, "Expected mismatch but got match");
  assert.ok(result.report.length > 0, "Expected non-empty diff report");
});

test("runHarness handles self-test fixtures correctly", () => {
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
      expect: "mismatch", // self-tests must declare expect: "mismatch"
      profiles: ["core-language"],
      events: [],
      diagnostics: [
        {
          code: "ol-undefined-var",
          source_span: { document: "test", start: [1, 1], end: [1, 1] },
          params: {},
          stage: "semantic",
          severity: "error",
        }, // expect a diagnostic that won't be there
      ],
    }),
  );

  const exitCode = runHarness({ root: TEMP_ROOT });
  // Self-test that doesn't match (as expected) should pass → exit 0
  assert.equal(exitCode, 0);
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
  writeFileSync(join(TEMP_ROOT, "orphan.logo"), "");
  // No .expected.json sibling

  assert.throws(
    () => discoverFixtures(TEMP_ROOT),
    /Orphan \.logo file\(s\) without \.expected\.json sibling/,
  );
});

test("discoverFixtures throws on orphan .expected.json file", () => {
  writeFileSync(
    join(TEMP_ROOT, "orphan.expected.json"),
    JSON.stringify({ profiles: [], events: [], diagnostics: [] }),
  );
  // No .logo sibling

  assert.throws(
    () => discoverFixtures(TEMP_ROOT),
    /Orphan \.expected\.json file\(s\) without \.logo sibling/,
  );
});

// Additional tests for uncovered branches in runHarness

test("runHarness handles self-test that wrongly matches", () => {
  // Create a self-test fixture that will match (which should fail)
  mkdirSync(join(TEMP_ROOT, "_harness-selftest", "wrongly-passes"), {
    recursive: true,
  });
  writeFileSync(
    join(
      TEMP_ROOT,
      "_harness-selftest",
      "wrongly-passes",
      "wrongly-passes.logo",
    ),
    "",
  );
  writeFileSync(
    join(
      TEMP_ROOT,
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

  const exitCode = runHarness({ root: TEMP_ROOT });
  assert.equal(exitCode, 1); // Should fail because self-test matched
});

// --- M5 profile-DAG registration (issue #666) ---------------------------------------------
// This slice (C4 of epic #658, saga #572) wires the four M5 profiles into the conformance
// harness's PROFILE_DEPS so per-profile fixtures and spec/examples run along the DAG as each
// terminal epic lands. These tests lock the registration to the NORMATIVE dependency edges in
// spec/conformance.md's profile DAG (the spec, not the issue summary, is authoritative), and
// prove that an empty M5 fixture set keeps the suite green.

test("PROFILE_DEPS registers heritage with core-language + data + turtle-rendering (spec DAG)", () => {
  // spec/conformance.md#heritage + the DAG: Heritage is alternate spellings only and depends on
  // Core Language, on Data (its `value of … for key` reader operates on dicts), AND on Turtle &
  // Rendering (issue #860): nine of its thirteen alias spellings — fd/bk/lt/rt/pu/pd/st/ht/cs —
  // spell Turtle & Rendering primitives, so owing those aliases means owning what they spell.
  assert.deepEqual(PROFILE_DEPS.heritage, [
    "core-language",
    "data",
    "turtle-rendering",
  ]);
  const closure = closureOf("heritage");
  assert.ok(closure.has("heritage"));
  assert.ok(closure.has("core-language"));
  assert.ok(closure.has("data"));
  assert.ok(closure.has("turtle-rendering"));
  assert.equal(closure.size, 4);
});

test("PROFILE_DEPS registers sprites with turtle-rendering (spec DAG)", () => {
  // spec/conformance.md#sprites: Sprites depends on Turtle & Rendering (which depends on Core).
  assert.deepEqual(PROFILE_DEPS.sprites, ["turtle-rendering"]);
  const closure = closureOf("sprites");
  assert.ok(closure.has("sprites"));
  assert.ok(closure.has("turtle-rendering"));
  assert.ok(closure.has("core-language"));
  assert.equal(closure.size, 3);
});

test("PROFILE_DEPS registers interaction-events as a Core-only optional profile (spec DAG)", () => {
  // spec/conformance.md#interaction--events: a separate optional profile depending only on Core.
  assert.deepEqual(PROFILE_DEPS["interaction-events"], ["core-language"]);
  const closure = closureOf("interaction-events");
  assert.ok(closure.has("interaction-events"));
  assert.ok(closure.has("core-language"));
  assert.equal(closure.size, 2);
});

test("PROFILE_DEPS registers sound as a separate Core-only optional profile (spec DAG)", () => {
  // spec/conformance.md#sound: a separate optional profile depending only on Core. It may SHARE
  // the event stream with Interaction & Events but carries no dependency edge to it.
  assert.deepEqual(PROFILE_DEPS.sound, ["core-language"]);
  const closure = closureOf("sound");
  assert.ok(closure.has("sound"));
  assert.ok(closure.has("core-language"));
  assert.ok(!closure.has("interaction-events"));
  assert.equal(closure.size, 2);
});

test("closureOf accepts every M5 profile (they are enumerable along the DAG)", () => {
  // Guards against a future edit dropping one from PROFILE_DEPS: closureOf throws on any profile
  // not in the DAG, so this is a live registration assertion, not a tautology.
  for (const profile of [
    "heritage",
    "sprites",
    "interaction-events",
    "sound",
  ]) {
    assert.doesNotThrow(() => closureOf(profile));
  }
});

test("an empty M5 profile fixture set keeps the harness green", () => {
  // Acceptance criterion: with no M5 fixtures present, the suite stays green. Scaffold the four M5
  // profile directories with only their README (as this slice ships), no .logo/.expected.json
  // pair, and confirm the harness reports success (exit 0) rather than failing on an empty set.
  for (const profile of [
    "heritage",
    "sprites",
    "interaction-events",
    "sound",
  ]) {
    mkdirSync(join(TEMP_ROOT, profile), { recursive: true });
    writeFileSync(
      join(TEMP_ROOT, profile, "README.md"),
      `# ${profile} fixtures (scaffolding, no fixtures yet)\n`,
    );
  }
  assert.equal(runHarness({ root: TEMP_ROOT }), 0);
});

test("a profile-filtered M5 run with no fixtures is green (exit 0)", () => {
  // The examples/fixtures run along the DAG per profile as each epic lands. Selecting an M5 profile
  // before any of its fixtures exist must not fail: discoverFixtures finds nothing, so runHarness
  // returns 0. (A README in the profile dir is ignored by discovery — only .logo/.expected.json
  // pairs are fixtures.)
  mkdirSync(join(TEMP_ROOT, "heritage"), { recursive: true });
  writeFileSync(join(TEMP_ROOT, "heritage", "README.md"), "# heritage\n");
  assert.equal(runHarness({ root: TEMP_ROOT, profile: "heritage" }), 0);
});

test("runHarness handles normal fixture failure", () => {
  // Create a normal fixture that will fail on a genuine comparison mismatch
  // (not an off-contract schema error — the diagnostic below is schema-valid).
  mkdirSync(join(TEMP_ROOT, "fail-test"), {
    recursive: true,
  });
  writeFileSync(join(TEMP_ROOT, "fail-test", "fail.logo"), "]");
  writeFileSync(
    join(TEMP_ROOT, "fail-test", "fail.expected.json"),
    JSON.stringify({
      profiles: ["core-language"],
      events: [],
      diagnostics: [
        {
          code: "ol-undefined-var", // Wrong diagnostic — actual is ol-bad-token
          source_span: { document: "test", start: [1, 1], end: [1, 1] },
          params: {},
          stage: "semantic",
          severity: "error",
        },
      ],
    }),
  );

  const exitCode = runHarness({ root: TEMP_ROOT });
  assert.equal(exitCode, 1); // Should fail
});

test("runHarness handles off-contract fixtures", () => {
  // Create an off-contract fixture (invalid profile)
  mkdirSync(join(TEMP_ROOT, "offcontract"), {
    recursive: true,
  });
  writeFileSync(join(TEMP_ROOT, "offcontract", "bad.logo"), "");
  writeFileSync(
    join(TEMP_ROOT, "offcontract", "bad.expected.json"),
    JSON.stringify({
      profiles: ["not-a-real-profile"],
      events: [],
      diagnostics: [],
    }),
  );

  const exitCode = runHarness({ root: TEMP_ROOT });
  assert.equal(exitCode, 1); // Should fail
});

test("runHarness requires self-tests to declare expect mismatch", () => {
  // Create a self-test without expect: "mismatch"
  mkdirSync(join(TEMP_ROOT, "_harness-selftest", "bad-expect"), {
    recursive: true,
  });
  writeFileSync(
    join(TEMP_ROOT, "_harness-selftest", "bad-expect", "bad-expect.logo"),
    "",
  );
  writeFileSync(
    join(
      TEMP_ROOT,
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

  const exitCode = runHarness({ root: TEMP_ROOT });
  assert.equal(exitCode, 1); // Should fail
});

test("runHarness runs self-tests even with --profile filter", () => {
  // Self-test with profiles:[] should still run when --profile is set
  mkdirSync(join(TEMP_ROOT, "_harness-selftest", "profile-test"), {
    recursive: true,
  });
  writeFileSync(
    join(TEMP_ROOT, "_harness-selftest", "profile-test", "profile-test.logo"),
    "]", // Parse error
  );
  writeFileSync(
    join(
      TEMP_ROOT,
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

  const exitCode = runHarness({ profile: "core-language", root: TEMP_ROOT });
  assert.equal(exitCode, 0); // Self-test should pass (mismatch correctly detected)
});

test("runHarness skips fixtures when --profile filter doesn't match", () => {
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
});

test("runHarness runs an opted-in execution fixture end to end", () => {
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
});

test("runHarness reports a mismatch for an opted-in execution fixture with wrong events", () => {
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
});

test("runHarness runs an opted-in check fixture end to end (clean pass)", () => {
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
});

test("runHarness reports a mismatch for an opted-in check fixture with wrong diagnostics", () => {
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
});

// --- issue #865: executeOptions.randomSeed ------------------------------------------------------
// `randomSeed` is a JSON-expressible ExecuteOptions key, so the allow-list must admit it — a
// fixture whose program uses `random` is otherwise unusable, which is the harness limitation #865
// names. These three tests pin acceptance, type rejection, and that the value reaches execute().

test("loadFixture reads an executeOptions.randomSeed (issue #865)", () => {
  mkdirSync(join(TEMP_ROOT, "with-random-seed"), { recursive: true });
  writeFileSync(
    join(TEMP_ROOT, "with-random-seed", "with-random-seed.logo"),
    "print random 100",
  );
  writeFileSync(
    join(TEMP_ROOT, "with-random-seed", "with-random-seed.expected.json"),
    JSON.stringify({
      profiles: ["core-language"],
      execute: true,
      executeOptions: { randomSeed: 123 },
      events: [],
      diagnostics: [],
    }),
  );

  const loaded = loadFixture({
    name: "with-random-seed/with-random-seed.expected.json",
    expectedPath: join(
      TEMP_ROOT,
      "with-random-seed",
      "with-random-seed.expected.json",
    ),
    logoPath: join(TEMP_ROOT, "with-random-seed", "with-random-seed.logo"),
  });

  assert.equal(loaded.error, undefined);
  assert.deepEqual(loaded.expected.executeOptions, { randomSeed: 123 });
});

test("loadFixture rejects a non-numeric executeOptions.randomSeed (issue #865)", () => {
  mkdirSync(join(TEMP_ROOT, "bad-random-seed"), { recursive: true });
  writeFileSync(
    join(TEMP_ROOT, "bad-random-seed", "bad-random-seed.logo"),
    "print 1",
  );
  writeFileSync(
    join(TEMP_ROOT, "bad-random-seed", "bad-random-seed.expected.json"),
    JSON.stringify({
      profiles: ["core-language"],
      execute: true,
      executeOptions: { randomSeed: "123" },
      events: [],
      diagnostics: [],
    }),
  );

  const loaded = loadFixture({
    name: "bad-random-seed/bad-random-seed.expected.json",
    expectedPath: join(
      TEMP_ROOT,
      "bad-random-seed",
      "bad-random-seed.expected.json",
    ),
    logoPath: join(TEMP_ROOT, "bad-random-seed", "bad-random-seed.logo"),
  });

  assert.equal(loaded.error, '"executeOptions.randomSeed" must be a number');
});

test("a fixture's executeOptions.randomSeed actually reaches execute() (issue #865)", () => {
  // Not just "it loads": the seed must be FORWARDED through the harness's own produce(), so the
  // same program under two different fixture seeds must produce two different draws — and 123 must
  // reproduce the sequence `packages/runtime/src/random-randomize.test.mjs` already pins for
  // `(randomize 123)`, which is what proves it is the real seeding path and not a coincidence.
  const drawnFor = (randomSeed) =>
    produce("print random 100", "fixture.logo", true, false, [], false, {
      randomSeed,
    }).events.filter((event) => event.kind === "print")[0].payload.values[0];

  assert.equal(drawnFor(123), 78);
  assert.equal(drawnFor(123), 78);
  assert.notEqual(drawnFor(4242), 78);
});

// --- Declared-profile gate for executed fixtures (issue #790) -------------------------------------
//
// A fixture's `profiles` array used to SELECT the fixture without ever GATING it: for an
// `"execute": true` fixture it never reached `execute()` at all, so a fixture whose source used
// Sprites forms passed with "sprites" deleted from its array. Measured on the parent commit, the
// real corpus had 8 such fixtures (all in core-language/execution/, all executing `:nums[i]` — Data
// by spec/conformance.md:269 — while declaring Core only), and none of them failed anything.

test("profileGateErrors fails an executed fixture whose source uses an undeclared profile", () => {
  const errors = profileGateErrors(
    { profiles: ["core-language"], execute: true, check: false },
    "tell [ :a ]",
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /source uses profile sprites/);
  assert.match(errors[0], /does not declare/);
});

test("profileGateErrors names every undeclared profile, not just the first", () => {
  const errors = profileGateErrors(
    { profiles: ["core-language"], execute: true, check: false },
    'print value of :d for key "k"',
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /source uses profiles data, heritage/);
});

test("profileGateErrors passes an executed fixture that declares what it uses", () => {
  assert.deepEqual(
    profileGateErrors(
      { profiles: ["sprites"], execute: true, check: false },
      "tell [ :a ]",
    ),
    [],
  );
});

test("profileGateErrors expands the declared set to its dependency closure", () => {
  // Sprites depends on Turtle & Rendering which depends on Core, and Geometry pulls in Data — so
  // declaring "geometry" alone already covers a source that reads a list by index.
  assert.deepEqual(
    profileGateErrors(
      { profiles: ["geometry"], execute: true, check: false },
      ":xs = [1 2]\nprint :xs[1]",
    ),
    [],
  );
});

test("profileGateErrors leaves parse-only fixtures alone (postfix-read grammar is unconditional Core syntax, spec/conformance.md:120)", () => {
  assert.deepEqual(
    profileGateErrors(
      { profiles: ["core-language"], execute: false, check: false },
      ":xs = [1 2]\nprint :xs[1]",
    ),
    [],
  );
});

test("profileGateErrors leaves check-mode fixtures alone — check() already gates them on the ACTIVE profile set, and the corpus's negative fixtures name an inactive profile's forms on purpose", () => {
  assert.deepEqual(
    profileGateErrors(
      { profiles: ["core-language"], execute: true, check: true },
      "tell [ :a ]",
    ),
    [],
  );
});

test("runHarness fails an executed fixture that under-declares its profiles", () => {
  mkdirSync(join(TEMP_ROOT, "under-declared"), { recursive: true });
  // The source MUST use an undeclared profile, and the fixture MUST otherwise pass, or this test
  // is not load-bearing: with a source like `print 1` the exit code would come from the empty
  // expected stream and deleting the profileGateErrors() call from runHarness would leave the test
  // green. `expect: "mismatch"` makes the deliberately-empty expected stream the *passing* outcome,
  // so the only thing that can fail this fixture is the profile gate itself.
  writeFileSync(
    join(TEMP_ROOT, "under-declared", "under-declared.logo"),
    ":xs = [1 2]\nclear :xs",
  );
  writeFileSync(
    join(TEMP_ROOT, "under-declared", "under-declared.expected.json"),
    JSON.stringify({
      profiles: ["core-language"],
      execute: true,
      expect: "mismatch",
      events: [],
      diagnostics: [],
    }),
  );
  assert.equal(runHarness({ root: TEMP_ROOT }), 1);
});

test("...and the identical fixture passes once `data` is declared — so the exit code above is the gate, not the comparison", () => {
  mkdirSync(join(TEMP_ROOT, "declared-pair"), { recursive: true });
  writeFileSync(
    join(TEMP_ROOT, "declared-pair", "declared-pair.logo"),
    ":xs = [1 2]\nclear :xs",
  );
  writeFileSync(
    join(TEMP_ROOT, "declared-pair", "declared-pair.expected.json"),
    JSON.stringify({
      profiles: ["core-language", "data"],
      execute: true,
      expect: "mismatch",
      events: [],
      diagnostics: [],
    }),
  );
  assert.equal(runHarness({ root: TEMP_ROOT }), 0);
});

test("runHarness reports the profile-gate violation only after the fixture's profile names are known-good, so closureOf never sees an unregistered one", () => {
  mkdirSync(join(TEMP_ROOT, "bogus-profile"), { recursive: true });
  writeFileSync(
    join(TEMP_ROOT, "bogus-profile", "bogus-profile.logo"),
    "tell [ :a ]",
  );
  writeFileSync(
    join(TEMP_ROOT, "bogus-profile", "bogus-profile.expected.json"),
    JSON.stringify({
      profiles: ["not-a-real-profile"],
      execute: true,
      events: [],
      diagnostics: [],
    }),
  );
  // Fails for the unknown profile rather than throwing out of closureOf.
  assert.equal(runHarness({ root: TEMP_ROOT }), 1);
});

// --- validateExecuteOptions (shared by the conformance harness and the examples gate) -------------

test("validateExecuteOptions accepts a well-formed options object", () => {
  assert.equal(
    validateExecuteOptions({
      randomSeed: 7,
      hostInput: { events: [{ tick: 1, kind: "click" }] },
    }),
    null,
  );
});

test("validateExecuteOptions rejects a non-object", () => {
  assert.match(validateExecuteOptions([]), /must be an object/);
});

test("validateExecuteOptions rejects an unknown key", () => {
  assert.match(
    validateExecuteOptions({ hostinput: {} }),
    /is not a JSON-expressible ExecuteOptions key/,
  );
});

test("validateExecuteOptions type-checks every known key", () => {
  assert.match(
    validateExecuteOptions({ instructionBudget: "10" }),
    /instructionBudget" must be a number/,
  );
  assert.match(
    validateExecuteOptions({ recursionDepthLimit: "10" }),
    /recursionDepthLimit" must be a number/,
  );
  assert.match(
    validateExecuteOptions({ signal: { aborted: "yes" } }),
    /signal" must be an object with a boolean "aborted"/,
  );
  assert.match(
    validateExecuteOptions({ learnerLevel: 3 }),
    /learnerLevel" must be a string/,
  );
  assert.match(
    validateExecuteOptions({ randomSeed: "7" }),
    /randomSeed" must be a number/,
  );
  assert.match(
    validateExecuteOptions({ hostInput: { events: "nope" } }),
    /hostInput.events" must be an array/,
  );
});
