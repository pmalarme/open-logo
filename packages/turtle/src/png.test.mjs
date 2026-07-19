import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/turtle";

const VIEWPORT = { width: 10, height: 8 };

// --- A tiny PNG/zlib-stored decoder, test-only, mirroring the encoder in png.ts ---------------
// This lets tests assert on actual decoded pixel colors rather than only on raw byte layout,
// without adding a PNG-decoding dependency to the package itself.

function readUint32BE(bytes, offset) {
  return (
    (bytes[offset] << 24) |
    (bytes[offset + 1] << 16) |
    (bytes[offset + 2] << 8) |
    bytes[offset + 3]
  );
}

function decodeZlibStored(bytes) {
  // Skip the 2-byte zlib header; read stored DEFLATE blocks until BFINAL; ignore the trailing
  // 4-byte Adler-32 (recomputing/verifying it is covered by a dedicated test below instead).
  let offset = 2;
  const chunks = [];
  for (;;) {
    const header = bytes[offset];
    const isFinal = (header & 1) === 1;
    const length = bytes[offset + 1] | (bytes[offset + 2] << 8);
    offset += 5;
    chunks.push(bytes.subarray(offset, offset + length));
    offset += length;
    if (isFinal) {
      break;
    }
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    result.set(chunk, at);
    at += chunk.length;
  }
  return result;
}

function decodePng(png) {
  assert.deepEqual(
    Array.from(png.subarray(0, 8)),
    [137, 80, 78, 71, 13, 10, 26, 10],
  );
  let offset = 8;
  let width = 0;
  let height = 0;
  let idat = null;
  while (offset < png.length) {
    const length = readUint32BE(png, offset);
    const type = String.fromCharCode(
      png[offset + 4],
      png[offset + 5],
      png[offset + 6],
      png[offset + 7],
    );
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = readUint32BE(data, 0);
      height = readUint32BE(data, 4);
      assert.equal(data[8], 8, "bit depth must be 8");
      assert.equal(data[9], 6, "color type must be 6 (RGBA)");
    }
    if (type === "IDAT") {
      idat = data;
    }
    offset += 8 + length + 4;
  }
  assert.ok(idat !== null, "PNG must contain an IDAT chunk");
  const raw = decodeZlibStored(idat);
  const stride = width * 4 + 1;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * stride;
    assert.equal(raw[rowStart], 0, "only filter type 0 (None) is produced");
    pixels.set(
      raw.subarray(rowStart + 1, rowStart + 1 + width * 4),
      y * width * 4,
    );
  }
  return { width, height, pixels };
}

function pixelAt(decoded, x, y) {
  const offset = (y * decoded.width + x) * 4;
  return {
    r: decoded.pixels[offset],
    g: decoded.pixels[offset + 1],
    b: decoded.pixels[offset + 2],
    a: decoded.pixels[offset + 3],
  };
}

const HIDDEN_STATE = {
  position: [0, 0],
  heading: 0,
  penDown: true,
  color: "black",
  width: 1,
  shape: "turtle",
  visible: false,
};

test("exportTurtlePng produces a valid PNG signature, IHDR size, and IDAT chunk", () => {
  const scene = { background: "white", items: [] };
  const png = OL.exportTurtlePng(scene, HIDDEN_STATE, VIEWPORT);
  const decoded = decodePng(png);
  assert.equal(decoded.width, 10);
  assert.equal(decoded.height, 8);
});

test("exportTurtlePng fills every pixel with the background color by default", () => {
  const scene = { background: "#ff0000", items: [] };
  const decoded = decodePng(OL.exportTurtlePng(scene, HIDDEN_STATE, VIEWPORT));
  assert.deepEqual(pixelAt(decoded, 0, 0), { r: 255, g: 0, b: 0, a: 255 });
  assert.deepEqual(pixelAt(decoded, 9, 7), { r: 255, g: 0, b: 0, a: 255 });
});

test("exportTurtlePng rasterizes a segment with its captured color", () => {
  const scene = {
    background: "white",
    items: [
      {
        kind: "segment",
        segment: { from: [-5, 0], to: [5, 0], color: "blue", width: 2 },
      },
    ],
  };
  const decoded = decodePng(OL.exportTurtlePng(scene, HIDDEN_STATE, VIEWPORT));
  // World (0,0) maps to target center (5,4); the horizontal segment passes through the middle row.
  const middle = pixelAt(decoded, 5, 4);
  assert.deepEqual(middle, { r: 0, g: 0, b: 255, a: 255 });
});

test("exportTurtlePng scales segment width through the viewport scale, matching Canvas/SVG", () => {
  const scene = {
    background: "white",
    items: [
      {
        kind: "segment",
        segment: { from: [-5, 0], to: [5, 0], color: "blue", width: 1 },
      },
    ],
  };
  const thin = decodePng(OL.exportTurtlePng(scene, HIDDEN_STATE, VIEWPORT));
  const thick = decodePng(
    OL.exportTurtlePng(scene, HIDDEN_STATE, { width: 10, height: 8, scale: 4 }),
  );
  // A wider effective stroke paints more blue pixels in the column above/below the centerline.
  const countBlue = (decoded) => {
    let count = 0;
    for (let y = 0; y < decoded.height; y += 1) {
      const { r, g, b } = pixelAt(decoded, 5, y);
      if (r === 0 && g === 0 && b === 255) {
        count += 1;
      }
    }
    return count;
  };
  assert.ok(countBlue(thick) > countBlue(thin));
});

test("exportTurtlePng omits a zero-length segment consistently (no divide-by-zero, no stray pixel)", () => {
  const scene = {
    background: "white",
    items: [
      {
        kind: "segment",
        segment: { from: [0, 0], to: [0, 0], color: "blue", width: 1 },
      },
    ],
  };
  const decoded = decodePng(OL.exportTurtlePng(scene, HIDDEN_STATE, VIEWPORT));
  for (let y = 0; y < decoded.height; y += 1) {
    for (let x = 0; x < decoded.width; x += 1) {
      assert.notDeepEqual(pixelAt(decoded, x, y), {
        r: 0,
        g: 0,
        b: 255,
        a: 255,
      });
    }
  }
});

test("exportTurtlePng rasterizes a fill polygon with its captured color", () => {
  const scene = {
    background: "white",
    items: [
      {
        kind: "segment",
        segment: { from: [-2, -2], to: [2, -2], color: "black", width: 1 },
      },
      {
        kind: "segment",
        segment: { from: [2, -2], to: [2, 2], color: "black", width: 1 },
      },
      {
        kind: "segment",
        segment: { from: [2, 2], to: [-2, 2], color: "black", width: 1 },
      },
      {
        kind: "segment",
        segment: { from: [-2, 2], to: [-2, -2], color: "black", width: 1 },
      },
      { kind: "fill", fill: { color: "green" } },
    ],
  };
  const decoded = decodePng(OL.exportTurtlePng(scene, HIDDEN_STATE, VIEWPORT));
  const center = pixelAt(decoded, 5, 4);
  assert.deepEqual(center, { r: 0, g: 128, b: 0, a: 255 });
});

test("exportTurtlePng rasterizes a stamp as a fixed avatar, independent of live state", () => {
  const scene = {
    background: "white",
    items: [
      {
        kind: "stamp",
        stamp: {
          position: [0, 0],
          heading: 0,
          shape: "triangle",
          color: "red",
        },
      },
    ],
  };
  const decoded = decodePng(OL.exportTurtlePng(scene, HIDDEN_STATE, VIEWPORT));
  // The triangle's nose points up from the origin; its body covers pixels below center.
  const belowCenter = pixelAt(decoded, 5, 5);
  assert.deepEqual(belowCenter, { r: 255, g: 0, b: 0, a: 255 });
});

test("exportTurtlePng rasterizes a circle-shape stamp", () => {
  const scene = {
    background: "white",
    items: [
      {
        kind: "stamp",
        stamp: { position: [0, 0], heading: 0, shape: "circle", color: "blue" },
      },
    ],
  };
  const decoded = decodePng(OL.exportTurtlePng(scene, HIDDEN_STATE, VIEWPORT));
  const center = pixelAt(decoded, 5, 4);
  assert.deepEqual(center, { r: 0, g: 0, b: 255, a: 255 });
});

test("exportTurtlePng includes the avatar when the turtle is visible", () => {
  const scene = { background: "white", items: [] };
  const state = { ...HIDDEN_STATE, shape: "circle", visible: true };
  const decoded = decodePng(OL.exportTurtlePng(scene, state, VIEWPORT));
  const center = pixelAt(decoded, 5, 4);
  assert.deepEqual(center, { r: 0, g: 0, b: 0, a: 255 });
});

test("exportTurtlePng excludes the avatar when the turtle is hidden", () => {
  const scene = { background: "white", items: [] };
  const decoded = decodePng(OL.exportTurtlePng(scene, HIDDEN_STATE, VIEWPORT));
  const center = pixelAt(decoded, 5, 4);
  assert.deepEqual(center, { r: 255, g: 255, b: 255, a: 255 });
});

test("exportTurtlePng's includeAvatar: false omits the avatar even when the turtle is visible", () => {
  const scene = { background: "white", items: [] };
  const state = { ...HIDDEN_STATE, shape: "circle", visible: true };
  const decoded = decodePng(
    OL.exportTurtlePng(scene, state, VIEWPORT, { includeAvatar: false }),
  );
  const center = pixelAt(decoded, 5, 4);
  assert.deepEqual(center, { r: 255, g: 255, b: 255, a: 255 });
});

test("exportTurtlePng's includeOverlays option is accepted but has no observable effect yet", () => {
  const scene = { background: "white", items: [] };
  const withOverlays = OL.exportTurtlePng(scene, HIDDEN_STATE, VIEWPORT, {
    includeOverlays: true,
  });
  const withoutOverlays = OL.exportTurtlePng(scene, HIDDEN_STATE, VIEWPORT, {
    includeOverlays: false,
  });
  assert.deepEqual(withOverlays, withoutOverlays);
});

test("exportTurtlePng is image-stable: the same scene/state/viewport exported twice is byte-identical", () => {
  const scene = {
    background: "white",
    items: [
      {
        kind: "segment",
        segment: { from: [-3, -3], to: [3, 3], color: "red", width: 2 },
      },
      { kind: "fill", fill: { color: "green" } },
      {
        kind: "stamp",
        stamp: { position: [1, 1], heading: 45, shape: "arrow", color: "blue" },
      },
    ],
  };
  const state = { ...HIDDEN_STATE, visible: true };
  const first = OL.exportTurtlePng(scene, state, VIEWPORT);
  const second = OL.exportTurtlePng(scene, state, VIEWPORT);
  assert.deepEqual(first, second);
});

test("exportTurtlePng clips drawing that falls outside the viewport instead of throwing", () => {
  const scene = {
    background: "white",
    items: [
      {
        kind: "segment",
        segment: {
          from: [-100, 0],
          to: [100, 0],
          color: "blue",
          width: 1,
        },
      },
    ],
  };
  const decoded = decodePng(OL.exportTurtlePng(scene, HIDDEN_STATE, VIEWPORT));
  // The segment runs far outside the 10x8 viewport on both ends; `fillPolygon` clamps its scan
  // range to the buffer bounds, so the visible middle row still paints without throwing. (A
  // 1-unit-wide horizontal segment centered on world y=0 lands the fill on target row 3, one
  // row above the exact center row, per the scanline fill's half-open `[y1, y2)` convention.)
  assert.deepEqual(pixelAt(decoded, 5, 3), { r: 0, g: 0, b: 255, a: 255 });
});

test("exportTurtlePng recognizes short (#rgb) and long (#rrggbb) hex colors", () => {
  const shortHexScene = { background: "#0f0", items: [] };
  const longHexScene = { background: "#00ff00", items: [] };
  const shortDecoded = decodePng(
    OL.exportTurtlePng(shortHexScene, HIDDEN_STATE, VIEWPORT),
  );
  const longDecoded = decodePng(
    OL.exportTurtlePng(longHexScene, HIDDEN_STATE, VIEWPORT),
  );
  assert.deepEqual(pixelAt(shortDecoded, 0, 0), { r: 0, g: 255, b: 0, a: 255 });
  assert.deepEqual(pixelAt(longDecoded, 0, 0), { r: 0, g: 255, b: 0, a: 255 });
});

test("exportTurtlePng falls back to opaque black for an unrecognized color word", () => {
  const scene = { background: "not-a-real-color", items: [] };
  const decoded = decodePng(OL.exportTurtlePng(scene, HIDDEN_STATE, VIEWPORT));
  assert.deepEqual(pixelAt(decoded, 0, 0), { r: 0, g: 0, b: 0, a: 255 });
});

test("exportTurtlePng spans multiple stored zlib blocks for a raster large enough to exceed 65535 bytes", () => {
  // 200x200x4 bytes of raw scanline data (before the 1-byte-per-row filter overhead) is well past
  // the 65535-byte stored-block limit, forcing zlibStore to emit more than one non-final block.
  const bigViewport = { width: 200, height: 200 };
  const scene = { background: "#112233", items: [] };
  const decoded = decodePng(
    OL.exportTurtlePng(scene, HIDDEN_STATE, bigViewport),
  );
  assert.equal(decoded.width, 200);
  assert.equal(decoded.height, 200);
  assert.deepEqual(pixelAt(decoded, 0, 0), {
    r: 0x11,
    g: 0x22,
    b: 0x33,
    a: 255,
  });
  assert.deepEqual(pixelAt(decoded, 199, 199), {
    r: 0x11,
    g: 0x22,
    b: 0x33,
    a: 255,
  });
});

test("exportTurtlePng produces a valid zlib stream whose Adler-32 checksum matches the raw data", () => {
  const scene = { background: "white", items: [] };
  const png = OL.exportTurtlePng(scene, HIDDEN_STATE, VIEWPORT);
  // Locate the IDAT chunk and independently recompute the Adler-32 trailer.
  let offset = 8;
  let idat = null;
  while (offset < png.length) {
    const length = readUint32BE(png, offset);
    const type = String.fromCharCode(
      png[offset + 4],
      png[offset + 5],
      png[offset + 6],
      png[offset + 7],
    );
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IDAT") {
      idat = data;
    }
    offset += 8 + length + 4;
  }
  const raw = decodeZlibStored(idat);
  const trailer = idat.subarray(idat.length - 4);
  const expectedAdler =
    (trailer[0] << 24) | (trailer[1] << 16) | (trailer[2] << 8) | trailer[3];

  const MOD_ADLER = 65521;
  let a = 1;
  let b = 0;
  for (const byte of raw) {
    a = (a + byte) % MOD_ADLER;
    b = (b + a) % MOD_ADLER;
  }
  const actualAdler = ((b << 16) | a) >>> 0;
  assert.equal(actualAdler >>> 0, expectedAdler >>> 0);
});
