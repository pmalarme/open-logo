import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

/**
 * Unit tests for the `on_key` visible-name registration (issue #684, slice I5) — the parser half of
 * the two-halves requirement. C2 (#664) registered `on_key` as a profile block-head form so it
 * PARSES, but the semantic checker's live `unknownCommandRule` gate walks a `ProfileStatement`'s
 * head keyword against `collectVisibleNames` and rejects any form not also registered as a visible
 * name. So this slice adds `on_key` to `collectVisibleNames`'s per-profile `interaction-events`
 * extension point: `on_key` must be VISIBLE under the `interaction-events` profile and REJECTED
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

test("on_key is a visible name under the interaction-events profile — the program checks clean", () => {
  assert.deepEqual(
    checkSource('on_key "space" [ forward 20 ]', withInteraction),
    [],
  );
});

test("the multiline on_key ... end on_key form also checks clean under the profile", () => {
  assert.deepEqual(
    checkSource('on_key "space"\n  forward 20\nend on_key', withInteraction),
    [],
  );
});

test("without the interaction-events profile, on_key is rejected with ol-unknown-command", () => {
  const diagnostics = checkSource('on_key "space" [ print "x" ]', coreOnly);
  assert.equal(diagnostics.length, 1);
  const [finding] = diagnostics;
  assert.equal(finding.code, "ol-unknown-command");
  assert.equal(finding.stage, "semantic");
  assert.equal(finding.severity, "error");
  assert.equal(finding.params.name, "on_key");
});

test("the rejection span covers just the `on_key` head keyword, not the whole statement", () => {
  const [finding] = checkSource('on_key "space" [ print "x" ]', coreOnly);
  assert.deepEqual(finding.source_span.start, [1, 1]);
  assert.deepEqual(finding.source_span.end, [1, 7]);
});

test("registering the profile does not make on_key visible to a sibling profile alone", () => {
  // Turtle & Rendering active but NOT interaction-events: `on_key` is still unknown. This guards
  // against the visible-name entry leaking outside its `active.has("interaction-events")` guard.
  const diagnostics = checkSource('on_key "space" [ forward 20 ]', [
    "core-language",
    "turtle-rendering",
  ]);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-unknown-command");
});
