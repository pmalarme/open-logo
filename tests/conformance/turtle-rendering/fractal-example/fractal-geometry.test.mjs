// Geometry pin for `spec/examples/12-fractal.logo` — issue #1112.
//
// WHY THIS FILE EXISTS
// --------------------
// The example draws a recursive tree, and until this file nothing asserted its geometry.
// `npm run examples` runs it, but that gate only asserts "parses and runs without raising", so the
// example's own closing line — `# expected final state: a recursive green tree is drawn and the
// turtle returns to the trunk base.` — was an unchecked claim. At the saga #819 merge-base
// (`3bfd5f01`) the program ran clean and drew a *bent stick*, and every gate stayed green.
//
// WHAT IS AND IS NOT A DISCRIMINATOR (all of this was MEASURED, not inferred)
// --------------------------------------------------------------------------
// Both commits below were cloned, `npm ci`-ed, built, and run through `@openlogo/runtime`'s
// `execute()` on this exact, byte-identical source file. `3bfd5f01` is the saga merge-base (the
// bent stick); `b7c627d9` is the saga tip (the tree).
//
//   axis                                3bfd5f01 (bent stick)      b7c627d9 (tree)
//   ----------------------------------  -------------------------  -------------------------
//   total events                        576                        576          <- IDENTICAL
//   draw-segment events                 30                         30           <- IDENTICAL
//   distinct undirected segments        15                         15           <- IDENTICAL
//   distinct segment endpoints          16                         16           <- IDENTICAL
//   diagnostics                         []                         []           <- IDENTICAL
//   distinct `move` headings            {0,30,60,90,270,300,330}   {same}       <- IDENTICAL
//   final position / heading            (0,-120) / 0               (0,-120) / 0 <- IDENTICAL
//   segment length histogram            15 lengths x 2 each        70x2 46.9x4 31.423x8 21.05341x16
//   mirror-symmetric about x=0          false                      true
//   bounding box x-range                [-2.174413, 71.716526]     [-71.716526, 71.716526]
//   bounding box y-range                [-120, 18.544059]          [-120, 40.272379]
//   per-segment endpoint coordinates    22 of 30 rows differ       pinned below
//
// So every count, shape-of-structure, diagnostic set and even the example's own documented
// "returns to the trunk base" claim is satisfied by the broken drawing too. A fixture asserting any
// of those would have passed on the bent stick. This file therefore discriminates on VALUES: the
// exact segment endpoints, the length histogram, the mirror symmetry, and the bounding box.
//
// The length histogram is the most legible of these. A correct depth-4 binary tree draws each
// branch outward and then retraces it, so it has exactly four lengths — 70 * 0.67^k for k in 0..3 —
// at doubling counts 2, 4, 8, 16. The broken run drew 30 segments too, but as 15 *distinct* lengths
// at 2 each (70 * 0.67^k for k in 0..14): every forward draw a different length, so no two sibling
// branches ever shared a level — one un-branched, ever-shrinking chain.
//
// PROOF THAT THIS FILE CAN FAIL
// -----------------------------
// This exact file was copied into the `3bfd5f01` build and run there: **4 of its 7 tests failed**
// (pinned endpoints, length histogram, mirror symmetry, bounding box). The 3 that passed are
// precisely the 3 marked "claim coverage, not a discriminator" below — the clean-run guard, the
// green/width-2 pen, and the return to the trunk base. Re-run that proof with:
//
//   git clone --no-checkout <repo> "$TMP/ol-mergebase" && cd "$TMP/ol-mergebase"
//   git checkout 3bfd5f01 && npm ci && npx tsc -b
//   cp -r <repo>/tests/conformance/turtle-rendering/fractal-example tests/conformance/turtle-rendering/
//   node --test tests/conformance/turtle-rendering/fractal-example/fractal-geometry.test.mjs
//
// WHY A `.test.mjs` AND NOT AN `.expected.json` FIXTURE
// ----------------------------------------------------
// The harness compares an expected event stream element-by-element across the whole stream
// (`diffStream` in `scripts/harness/index.mjs`), so an `.expected.json` here would have to
// enumerate all 576 events, and its `.logo` would have to be a COPY of the spec example — a second
// copy that can drift from the original, the exact hazard
// `../../geometry/stdlib/source-drift.test.mjs` exists to police. Reading the real
// `spec/examples/12-fractal.logo` makes drift impossible and keeps the assertions readable. It also
// stays renderer-independent: everything asserted here comes from the normative trace/event stream
// (`draw-segment` payload shape: `spec/execution-model.md:1078`), not from a rasterized image, so a
// legitimate rendering change cannot break this file for the wrong reason.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execute } from "@openlogo/runtime";

const EXAMPLE_PATH = join("spec", "examples", "12-fractal.logo");
const DOCUMENT = "spec/examples/12-fractal.logo";

/**
 * Six decimal places is far finer than anything that could distinguish this drawing (the correct
 * and broken runs differ by tens of units) and far coarser than IEEE-754 / trig last-ULP noise at
 * this magnitude (~1e-13 on coordinates around 70), so it pins real geometry without pinning float
 * dust: the raw stream carries values such as `3.552713678800501e-15` and `23.450000000000003`.
 * Adding `0` normalizes a rounded `-0` to `0`, because `assert.deepEqual` (strict) tells them apart.
 */
function round(value) {
  return Number(value.toFixed(6)) + 0;
}

/** The two endpoints of a segment, order-independent, as a comparable string. */
function canonicalSegment([fromX, fromY, toX, toY]) {
  return JSON.stringify(
    [
      [fromX, fromY],
      [toX, toY],
    ].sort(),
  );
}

/** The same segment reflected across the trunk's vertical axis, `x = 0`. */
function mirrorSegment([fromX, fromY, toX, toY]) {
  return [round(-fromX), fromY, round(-toX), toY];
}

function segmentLength([fromX, fromY, toX, toY]) {
  return round(Math.hypot(toX - fromX, toY - fromY));
}

/** `[length, count]` pairs, longest branch first — the recursion-depth signature. */
function lengthHistogram(segments) {
  const counts = new Map();
  for (const segment of segments) {
    const length = segmentLength(segment);
    counts.set(length, (counts.get(length) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[0] - a[0]);
}

const run = execute(readFileSync(EXAMPLE_PATH, "utf8"), DOCUMENT);
const drawSegmentEvents = run.events.filter(
  (event) => event.kind === "draw-segment",
);
const moveEvents = run.events.filter((event) => event.kind === "move");

/** Every drawn segment as `[fromX, fromY, toX, toY]`, in emission order. */
const drawnSegments = drawSegmentEvents.map((event) => [
  round(event.payload.from[0]),
  round(event.payload.from[1]),
  round(event.payload.to[0]),
  round(event.payload.to[1]),
]);

/**
 * The drawing, pinned. Read it as the trunk (row 1) followed by a depth-first walk of the tree:
 * each branch is drawn outward and then retraced on the way back, which is why every interior
 * coordinate appears an even number of times and why 15 branches produce 30 segments.
 */
const EXPECTED_SEGMENTS = [
  [0, -120, 0, -50],
  [0, -50, 23.45, -9.383409],
  [23.45, -9.383409, 50.663116, 6.328091],
  [50.663116, 6.328091, 71.716526, 6.328091],
  [71.716526, 6.328091, 50.663116, 6.328091],
  [50.663116, 6.328091, 61.189821, 24.560879],
  [61.189821, 24.560879, 50.663116, 6.328091],
  [50.663116, 6.328091, 23.45, -9.383409],
  [23.45, -9.383409, 23.45, 22.039591],
  [23.45, 22.039591, 33.976705, 40.272379],
  [33.976705, 40.272379, 23.45, 22.039591],
  [23.45, 22.039591, 12.923295, 40.272379],
  [12.923295, 40.272379, 23.45, 22.039591],
  [23.45, 22.039591, 23.45, -9.383409],
  [23.45, -9.383409, 0, -50],
  [0, -50, -23.45, -9.383409],
  [-23.45, -9.383409, -23.45, 22.039591],
  [-23.45, 22.039591, -12.923295, 40.272379],
  [-12.923295, 40.272379, -23.45, 22.039591],
  [-23.45, 22.039591, -33.976705, 40.272379],
  [-33.976705, 40.272379, -23.45, 22.039591],
  [-23.45, 22.039591, -23.45, -9.383409],
  [-23.45, -9.383409, -50.663116, 6.328091],
  [-50.663116, 6.328091, -61.189821, 24.560879],
  [-61.189821, 24.560879, -50.663116, 6.328091],
  [-50.663116, 6.328091, -71.716526, 6.328091],
  [-71.716526, 6.328091, -50.663116, 6.328091],
  [-50.663116, 6.328091, -23.45, -9.383409],
  [-23.45, -9.383409, 0, -50],
  [0, -50, 0, -120],
];

test("12-fractal: the example runs clean, so every geometry claim below is about a successful run", () => {
  assert.deepEqual(run.diagnostics, []);
});

test("12-fractal: every drawn segment matches its pinned endpoints", () => {
  // THE discriminating assertion. Measured at 3bfd5f01: 8 of the 30 rows still matched (indices
  // 0-4, 7, 14 and 29 — the trunk and the outward legs drawn before the recursion can go wrong,
  // plus the retraces back down it), and the other 22 differed, first diverging at index 5.
  assert.deepEqual(drawnSegments, EXPECTED_SEGMENTS);
});

test("12-fractal: branch lengths shrink and double in count over four levels — a tree, not a chain", () => {
  // Measured at 3bfd5f01: 15 entries, every count 2. A depth-4 binary tree has exactly 4.
  assert.deepEqual(lengthHistogram(drawnSegments), [
    [70, 2],
    [46.9, 4],
    [31.423, 8],
    [21.05341, 16],
  ]);
});

test("12-fractal: the drawing is mirror-symmetric about the trunk", () => {
  // The two turns the example balances are -30 and +30, so the tree must be its own reflection
  // across x = 0. Measured at 3bfd5f01: false — the bent stick leans entirely to one side.
  const drawn = drawnSegments.map(canonicalSegment).sort();
  const reflected = drawnSegments
    .map((segment) => canonicalSegment(mirrorSegment(segment)))
    .sort();
  assert.deepEqual(reflected, drawn);
});

test("12-fractal: the crown spreads to both sides of the trunk and above it", () => {
  // Measured at 3bfd5f01: x spanned [-2.174413, 71.716526] and y topped out at 18.544059 — a
  // one-sided, stunted figure.
  const xs = drawnSegments.flatMap(([fromX, , toX]) => [fromX, toX]);
  const ys = drawnSegments.flatMap(([, fromY, , toY]) => [fromY, toY]);
  assert.deepEqual(
    {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
    },
    { minX: -71.716526, maxX: 71.716526, minY: -120, maxY: 40.272379 },
  );
});

test("12-fractal: the whole tree is drawn green at width 2", () => {
  // Pins the "green" half of the example's own `# expected final state` line. Honest caveat: this
  // was already true at 3bfd5f01 (the bent stick was green too), so it is claim coverage, not a
  // discriminator.
  const pens = new Set(
    drawSegmentEvents.map((event) =>
      JSON.stringify([event.payload.color, event.payload.width]),
    ),
  );
  assert.deepEqual([...pens], [JSON.stringify(["green", 2])]);
});

test("12-fractal: the turtle returns to the trunk base at its starting heading", () => {
  // Pins the "returns to the trunk base" half of the example's `# expected final state` line.
  // Honest caveat: also already true at 3bfd5f01 — the bent stick retraced itself back to the base
  // as well — so this is claim coverage, not discrimination.
  const final = moveEvents.at(-1).payload;
  assert.deepEqual(
    [round(final.to[0]), round(final.to[1]), round(final.heading)],
    [0, -120, 0],
  );
});
