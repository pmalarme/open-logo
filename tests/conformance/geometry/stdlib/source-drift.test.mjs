// Zero-drift guard for issue #338 (Geometry standard library, maintainer re-scope).
//
// The conformance harness and examples gate both run a single self-contained `.logo` program
// (see scripts/harness/index.mjs's `produce()` — there is no `import`/prelude hook until the M6
// Modules profile), so every fixture in this directory that exercises `polygon`/`star`/`circle`/
// `arc`/`area`/`perimeter` must INLINE the exact packaged-command source verbatim. This test is
// the single source-of-truth bridge: it reads the real `stdlib/geometry/*.logo` files (the ones
// authored from spec/geometry-module.md) and asserts every fixture `.logo` file that calls a
// given command contains that command's real source as an exact substring — so the shipped
// stdlib and the tested stdlib can never silently drift apart.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const STDLIB_DIR = join("stdlib", "geometry");
const FIXTURES_DIR = join("tests", "conformance", "geometry", "stdlib");

/** Maps each packaged command to the `.logo` fixtures (in this directory) that call it. */
const FIXTURES_BY_COMMAND = {
  polygon: [
    "polygon-happy",
    "polygon-too-few-sides",
    "polygon-non-integer-sides",
  ],
  star: ["star-default-step", "star-explicit-step", "star-bad-step"],
  circle: [
    "circle-default-segments",
    "circle-explicit-segments",
    "circle-bad-radius",
    "circle-too-few-segments",
  ],
  arc: ["arc-happy", "arc-negative-angle", "arc-bad-radius"],
  area: ["area-polygon", "area-circle", "area-bad-shape"],
  perimeter: ["perimeter-polygon", "perimeter-circle", "perimeter-bad-shape"],
};

/**
 * Files *outside* this directory that also inline packaged-command source and therefore must be
 * covered by the same drift guard (issue #408, F11): the runnable spec example — the one place a
 * learner reads to see every packaged command used together — and the geometric-reasoning
 * conformance fixture that cross-validates `reasonAboutArc` against a real `arc` execution.
 */
const EXTERNAL_SOURCES_BY_COMMAND = {
  polygon: [join("spec", "examples", "13-geometry-stdlib.logo")],
  star: [join("spec", "examples", "13-geometry-stdlib.logo")],
  circle: [join("spec", "examples", "13-geometry-stdlib.logo")],
  arc: [
    join("spec", "examples", "13-geometry-stdlib.logo"),
    join(
      "tests",
      "conformance",
      "geometry",
      "reasoning",
      "arc-quarter-turn.logo",
    ),
  ],
  area: [join("spec", "examples", "13-geometry-stdlib.logo")],
  perimeter: [join("spec", "examples", "13-geometry-stdlib.logo")],
};

/**
 * Line endings are a checkout/platform detail (this repo's Windows working copies normalize to
 * CRLF while git blobs — and Linux CI checkouts — stay LF); normalizing to `\n` before comparing
 * keeps this a pure content/drift check, not a line-ending check.
 */
function normalizeNewlines(text) {
  return text.replace(/\r\n/g, "\n");
}

/**
 * The shipped stdlib/geometry/*.logo files carry a leading `#`-comment header documenting the
 * command (spec reference, formula, guards) — that documentation is additive and is NOT part of
 * the fixtures' inlined copies, which stay bare `define ... end` bodies. Stripping only the
 * leading contiguous comment/blank prefix (not every `#` line anywhere in the file) isolates the
 * executable source so the drift check still asserts exact equality of the part that must never
 * drift — the `define ... end` block itself — while still catching a stray `#` comment written
 * inside the body, which would otherwise silently escape the fixture-drift check.
 */
function stripLeadingComments(text) {
  const lines = text.split("\n");
  let index = 0;
  while (index < lines.length) {
    const line = lines[index].trimStart();
    if (line === "" || line.startsWith("#")) {
      index += 1;
    } else {
      break;
    }
  }
  return lines.slice(index).join("\n");
}

for (const [command, fixtureNames] of Object.entries(FIXTURES_BY_COMMAND)) {
  test(`${command}: every stdlib/geometry/${command}.logo call site inlines the real source verbatim`, () => {
    const realSource = stripLeadingComments(
      normalizeNewlines(
        readFileSync(join(STDLIB_DIR, `${command}.logo`), "utf8"),
      ),
    );
    assert.ok(
      realSource.startsWith(`define ${command} `),
      `stdlib/geometry/${command}.logo must define \`${command}\` (after stripping its doc comment header)`,
    );
    for (const fixtureName of fixtureNames) {
      const fixtureSource = normalizeNewlines(
        readFileSync(join(FIXTURES_DIR, `${fixtureName}.logo`), "utf8"),
      );
      assert.ok(
        fixtureSource.includes(realSource),
        `fixture "${fixtureName}.logo" does not inline the exact stdlib/geometry/${command}.logo source — ` +
          "the fixture has drifted from the shipped stdlib file",
      );
    }
  });
}

for (const [command, externalPaths] of Object.entries(
  EXTERNAL_SOURCES_BY_COMMAND,
)) {
  for (const externalPath of externalPaths) {
    test(`${command}: ${externalPath} inlines the real stdlib/geometry/${command}.logo source verbatim (issue #408 F11)`, () => {
      const realSource = stripLeadingComments(
        normalizeNewlines(
          readFileSync(join(STDLIB_DIR, `${command}.logo`), "utf8"),
        ),
      );
      const externalSource = normalizeNewlines(
        readFileSync(externalPath, "utf8"),
      );
      assert.ok(
        externalSource.includes(realSource),
        `${externalPath} does not inline the exact stdlib/geometry/${command}.logo source — ` +
          "it has drifted from the shipped stdlib file (docs/adr/0012-standard-library-location.md)",
      );
    });
  }
}

test("FIXTURES_BY_COMMAND accounts for every .logo fixture in this directory", () => {
  // Guards against a future fixture being added without drift coverage: every `.logo` file
  // physically present here must appear in the mapping above, and vice versa.
  const actualFixtureNames = readdirSync(FIXTURES_DIR)
    .filter((name) => name.endsWith(".logo"))
    .map((name) => name.slice(0, -".logo".length))
    .sort();
  const mappedFixtureNames = Object.values(FIXTURES_BY_COMMAND).flat().sort();
  assert.deepEqual(
    actualFixtureNames,
    mappedFixtureNames,
    "every *.logo fixture in tests/conformance/geometry/stdlib/ must be listed exactly once in FIXTURES_BY_COMMAND",
  );
});
