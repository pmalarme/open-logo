import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const SPAN = { document: "main.logo", start: [1, 1], end: [1, 8] };

function program(body = []) {
  return OL.ast.program(body, SPAN);
}

test("check returns an empty diagnostics list for the default (Core-only) profile set", () => {
  const result = OL.check(program());
  assert.deepEqual(result.diagnostics, []);
});

test("check returns an empty diagnostics list for a non-empty program", () => {
  const call = OL.ast.call(
    { name: "print", source_span: SPAN },
    [OL.ast.numberLit(1, SPAN)],
    SPAN,
  );
  const result = OL.check(program([call]));
  assert.deepEqual(result.diagnostics, []);
});

test("check accepts an explicit active profile set", () => {
  const result = OL.check(program(), {
    profiles: ["core-language", "turtle-rendering"],
  });
  assert.deepEqual(result.diagnostics, []);
});

test("check accepts an empty explicit profile set (no profiles active)", () => {
  const result = OL.check(program(), { profiles: [] });
  assert.deepEqual(result.diagnostics, []);
});

test("OL_CHECK_PROFILES and DEFAULT_CHECK_PROFILES expose the spec's profile DAG", () => {
  assert.ok(OL.OL_CHECK_PROFILES.includes("core-language"));
  assert.ok(OL.OL_CHECK_PROFILES.includes("tutor-ai"));
  assert.equal(OL.OL_CHECK_PROFILES.length, 12);
  assert.deepEqual(OL.DEFAULT_CHECK_PROFILES, ["core-language"]);
});
