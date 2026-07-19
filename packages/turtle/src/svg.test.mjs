import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/turtle";

const VIEWPORT = { width: 400, height: 300 };

test("exportTurtleSvg includes the SVG root with viewBox matching the viewport", () => {
  const scene = { background: "white", items: [] };
  const state = {
    position: [0, 0],
    heading: 0,
    penDown: true,
    color: "black",
    width: 1,
    shape: "turtle",
    visible: false,
  };
  const svg = OL.exportTurtleSvg(scene, state, VIEWPORT);
  assert.ok(
    svg.startsWith(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"',
    ),
  );
  assert.ok(svg.includes('viewBox="0 0 400 300"'));
  assert.ok(svg.trim().endsWith("</svg>"));
});

test("exportTurtleSvg always includes the background, even for an empty scene", () => {
  const scene = { background: "yellow", items: [] };
  const state = {
    position: [0, 0],
    heading: 0,
    penDown: true,
    color: "black",
    width: 1,
    shape: "turtle",
    visible: false,
  };
  const svg = OL.exportTurtleSvg(scene, state, VIEWPORT);
  assert.ok(
    svg.includes(
      '<rect x="0.000" y="0.000" width="400.000" height="300.000" fill="yellow"/>',
    ),
  );
});

test("exportTurtleSvg serializes a segment as a path with color, scaled width, and mapped coordinates", () => {
  const scene = {
    background: "white",
    items: [
      {
        kind: "segment",
        segment: { from: [0, 0], to: [0, 100], color: "red", width: 3 },
      },
    ],
  };
  const state = {
    position: [0, 0],
    heading: 0,
    penDown: true,
    color: "black",
    width: 1,
    shape: "turtle",
    visible: false,
  };
  const svg = OL.exportTurtleSvg(scene, state, VIEWPORT);
  assert.ok(
    svg.includes(
      '<path d="M 200.000 150.000 L 200.000 50.000" fill="none" stroke="red" stroke-width="3.000"/>',
    ),
  );
});

test("exportTurtleSvg scales segment stroke width through the viewport scale, matching Canvas", () => {
  const scene = {
    background: "white",
    items: [
      {
        kind: "segment",
        segment: { from: [0, 0], to: [0, 0], color: "red", width: 3 },
      },
    ],
  };
  const state = {
    position: [0, 0],
    heading: 0,
    penDown: true,
    color: "black",
    width: 1,
    shape: "turtle",
    visible: false,
  };
  const svg = OL.exportTurtleSvg(scene, state, {
    width: 400,
    height: 300,
    scale: 2,
  });
  assert.ok(svg.includes('stroke-width="6.000"'));
});

test("exportTurtleSvg reconstructs a fill as a filled path", () => {
  const scene = {
    background: "white",
    items: [
      {
        kind: "segment",
        segment: { from: [0, 0], to: [10, 0], color: "black", width: 1 },
      },
      {
        kind: "segment",
        segment: { from: [10, 0], to: [10, 10], color: "black", width: 1 },
      },
      {
        kind: "segment",
        segment: { from: [10, 10], to: [0, 10], color: "black", width: 1 },
      },
      {
        kind: "segment",
        segment: { from: [0, 10], to: [0, 0], color: "black", width: 1 },
      },
      { kind: "fill", fill: { color: "green" } },
    ],
  };
  const state = {
    position: [0, 0],
    heading: 0,
    penDown: true,
    color: "black",
    width: 1,
    shape: "turtle",
    visible: false,
  };
  const svg = OL.exportTurtleSvg(scene, state, VIEWPORT);
  assert.ok(svg.includes('fill="green"'));
  assert.match(svg, /<path d="M [\d.-]+ [\d.-]+ L .* Z" fill="green"\/>/);
});

test("exportTurtleSvg serializes a stamp as a fixed avatar with a transform, independent of live state", () => {
  const scene = {
    background: "white",
    items: [
      {
        kind: "stamp",
        stamp: {
          position: [0, 0],
          heading: 90,
          shape: "triangle",
          color: "purple",
        },
      },
    ],
  };
  const state = {
    position: [50, 50],
    heading: 0,
    penDown: true,
    color: "black",
    width: 1,
    shape: "circle",
    visible: false,
  };
  const svg = OL.exportTurtleSvg(scene, state, VIEWPORT);
  assert.ok(
    svg.includes('transform="translate(200.000 150.000) rotate(90.000)"'),
  );
  assert.ok(svg.includes('fill="purple"'));
});

test("exportTurtleSvg serializes a circle-shape stamp as an SVG <circle> element", () => {
  const scene = {
    background: "white",
    items: [
      {
        kind: "stamp",
        stamp: { position: [0, 0], heading: 0, shape: "circle", color: "blue" },
      },
    ],
  };
  const state = {
    position: [0, 0],
    heading: 0,
    penDown: true,
    color: "black",
    width: 1,
    shape: "turtle",
    visible: false,
  };
  const svg = OL.exportTurtleSvg(scene, state, VIEWPORT);
  assert.match(
    svg,
    /<circle cx="0\.000" cy="0\.000" r="5\.000" fill="blue" transform="[^"]*"\/>/,
  );
});

test("exportTurtleSvg includes the avatar when the turtle is visible", () => {
  const scene = { background: "white", items: [] };
  const state = {
    position: [0, 0],
    heading: 0,
    penDown: true,
    color: "black",
    width: 1,
    shape: "triangle",
    visible: true,
  };
  const svg = OL.exportTurtleSvg(scene, state, VIEWPORT);
  assert.ok(svg.includes('fill="black"'));
  // The avatar shape is drawn in local coordinates (matching Canvas); the SVG `transform`
  // attribute (not baked-in coordinates) positions/rotates it at the turtle's world location.
  assert.ok(svg.includes('<path d="M 0.000 -10.000'));
  assert.ok(
    svg.includes('transform="translate(200.000 150.000) rotate(0.000)"'),
  );
});

test("exportTurtleSvg excludes the avatar when the turtle is hidden", () => {
  const scene = { background: "white", items: [] };
  const state = {
    position: [0, 0],
    heading: 0,
    penDown: true,
    color: "black",
    width: 1,
    shape: "triangle",
    visible: false,
  };
  const svg = OL.exportTurtleSvg(scene, state, VIEWPORT);
  assert.ok(!svg.includes("transform="));
});

test("exportTurtleSvg's includeAvatar: false omits the avatar even when the turtle is visible", () => {
  const scene = { background: "white", items: [] };
  const state = {
    position: [0, 0],
    heading: 0,
    penDown: true,
    color: "black",
    width: 1,
    shape: "triangle",
    visible: true,
  };
  const svg = OL.exportTurtleSvg(scene, state, VIEWPORT, {
    includeAvatar: false,
  });
  assert.ok(!svg.includes("transform="));
});

test("exportTurtleSvg normalizes color case and whitespace deterministically", () => {
  const scene = {
    background: " White ",
    items: [
      {
        kind: "segment",
        segment: { from: [0, 0], to: [1, 0], color: "#FF0000", width: 1 },
      },
    ],
  };
  const state = {
    position: [0, 0],
    heading: 0,
    penDown: true,
    color: "black",
    width: 1,
    shape: "turtle",
    visible: false,
  };
  const svg = OL.exportTurtleSvg(scene, state, VIEWPORT);
  assert.ok(svg.includes('fill="white"'));
  assert.ok(svg.includes('stroke="#ff0000"'));
});

test("exportTurtleSvg is byte-stable: the same scene/state/viewport exported twice is identical", () => {
  const scene = {
    background: "white",
    items: [
      {
        kind: "segment",
        segment: { from: [0, 0], to: [10, 10], color: "red", width: 2 },
      },
      { kind: "fill", fill: { color: "green" } },
      {
        kind: "stamp",
        stamp: { position: [5, 5], heading: 45, shape: "arrow", color: "blue" },
      },
    ],
  };
  const state = {
    position: [10, 10],
    heading: 180,
    penDown: false,
    color: "black",
    width: 1,
    shape: "turtle",
    visible: true,
  };
  const first = OL.exportTurtleSvg(scene, state, VIEWPORT, {
    includeOverlays: true,
  });
  const second = OL.exportTurtleSvg(scene, state, VIEWPORT, {
    includeOverlays: true,
  });
  assert.equal(first, second);
});

test("exportTurtleSvg's includeOverlays option is accepted but has no observable effect yet (no overlay data exists)", () => {
  const scene = { background: "white", items: [] };
  const state = {
    position: [0, 0],
    heading: 0,
    penDown: true,
    color: "black",
    width: 1,
    shape: "turtle",
    visible: false,
  };
  const withOverlays = OL.exportTurtleSvg(scene, state, VIEWPORT, {
    includeOverlays: true,
  });
  const withoutOverlays = OL.exportTurtleSvg(scene, state, VIEWPORT, {
    includeOverlays: false,
  });
  assert.equal(withOverlays, withoutOverlays);
});
