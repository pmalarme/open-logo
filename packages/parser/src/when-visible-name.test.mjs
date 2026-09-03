import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

/**
 * Unit tests for the `when` visible-name registration (issue #682, slice I3) — the parser half of
 * the two-halves requirement. C2 (#664) registered `when` as a profile block-head form so it
 * PARSES, but the semantic checker's live `unknownCommandRule` gate walks a `ProfileStatement`'s
 * head keyword against `collectVisibleNames` and rejects any form not also registered as a visible
 * name. So this slice adds `when` to `collectVisibleNames`'s per-profile `interaction-events`
 * extension point: `when` must be VISIBLE under the `interaction-events` profile and REJECTED
 * (`ol-unknown-command`) without it. Verified black-box against the built `check()` entry point,
 * per the shared co-located `*.test.mjs` convention (importing only `@openlogo/parser`).
 */

const withInteraction = [
  "core-language",
  "turtle-rendering",
  "interaction-events",
];
const coreOnly = ["core-language"];

function checkSource(source, profiles) {
  const { ast, diagnostics: parseDiagnostics } = OL.parse(source, "unit.logo");
  assert.deepEqual(
    parseDiagnostics,
    [],
    `expected clean parse for ${JSON.stringify(source)}`,
  );
  return OL.check(ast, { profiles }).diagnostics;
}

test("when is a visible name under the interaction-events profile — the program checks clean", () => {
  assert.deepEqual(
    checkSource('when "start" [ print "ready" ]', withInteraction),
    [],
  );
});

test("the multiline when ... end when form also checks clean under the profile", () => {
  assert.deepEqual(
    checkSource('when "start"\n  print "ready"\nend when', withInteraction),
    [],
  );
});

test("without the interaction-events profile, when is rejected with ol-unknown-command", () => {
  const diagnostics = checkSource('when "start" [ print "ready" ]', coreOnly);
  assert.equal(diagnostics.length, 1);
  const [finding] = diagnostics;
  assert.equal(finding.code, "ol-unknown-command");
  assert.equal(finding.stage, "semantic");
  assert.equal(finding.severity, "error");
  assert.equal(finding.params.name, "when");
});

test("the rejection span covers just the `when` head keyword, not the whole statement", () => {
  const [finding] = checkSource('when "start" [ print "ready" ]', coreOnly);
  assert.deepEqual(finding.source_span.start, [1, 1]);
  assert.deepEqual(finding.source_span.end, [1, 5]);
});

test("registering the profile does not make when visible to a sibling profile alone", () => {
  // Turtle & Rendering active but NOT interaction-events: `when` is still unknown. This guards
  // against the visible-name entry leaking outside its `active.has(\"interaction-events\")` guard.
  const diagnostics = checkSource('when "start" [ print "ready" ]', [
    "core-language",
    "turtle-rendering",
  ]);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-unknown-command");
});
