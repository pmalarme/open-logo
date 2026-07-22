import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { execute } from "@openlogo/runtime";

/**
 * Runnable edu-level example for issue #338's Geometry standard library: exercises all six
 * `polygon`/`star`/`circle`/`arc`/`area`/`perimeter` commands/reporters in one program, inlining
 * the same verbatim source `@openlogo/edu`'s `GEOMETRY_STDLIB` registry ships (there is no
 * stdlib/prelude injection hook in `execute()` — see `packages/edu/src/geometry/registry.ts`).
 * This mirrors `spec/examples/06-geometry.logo`'s pattern without touching maintainer-owned
 * `spec/examples/**`.
 */

const examplePath = fileURLToPath(
  new URL("./geometry-stdlib.logo", import.meta.url),
);

test("geometry-stdlib.logo example runs with no diagnostics and reports the documented values", () => {
  const source = readFileSync(examplePath, "utf8");
  const { events, diagnostics } = execute(source, "geometry-stdlib.logo");
  assert.deepEqual(diagnostics, []);

  const prints = events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
  assert.equal(prints.length, 4);
  const [areaPolygon, areaCircle, perimeterPolygon, perimeterCircle] = prints;
  assert.ok(
    Math.abs(
      areaPolygon -
        (5 * 100 ** 2) / (4 * Math.tan((180 / 5) * (Math.PI / 180))),
    ) < 1e-6,
  );
  assert.ok(Math.abs(areaCircle - Math.PI * 50 ** 2) < 1e-6);
  assert.equal(perimeterPolygon, 500);
  assert.ok(Math.abs(perimeterCircle - 2 * Math.PI * 50) < 1e-6);
});
