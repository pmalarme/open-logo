/**
 * Deterministic PNG export: rasterizes the retained {@link TurtleScene} (`scene.ts`) plus the
 * turtle avatar from {@link TurtleState} (`state.ts`) into a PNG image, per `spec/rendering.md`'s
 * "Rendering targets" and "Export determinism" sections.
 *
 * Like `svg.ts` (#215), this module never re-derives the coordinate mapping or draw order: it
 * drives the pixel rasterizer through the **same** {@link RenderTarget} abstraction and the
 * **same** exported `paintScene`/`paintTurtle` orchestration from `canvas.ts` (#214) — so PNG,
 * SVG, and Canvas all agree on world-to-target mapping, draw order, pen-width scaling, and
 * avatar/visibility rules by construction, not by re-implementing the same decisions three times.
 *
 * Unlike SVG (a text format the browser/consumer rasterizes later), PNG export must itself
 * rasterize vector geometry into pixels and encode a real PNG byte stream — there is no `dom`
 * lib and no `node-canvas` dependency in this package (the same headless/dependency-free
 * constraint established in #214), so this module implements:
 *
 * - A minimal pure-TypeScript rasterizer (`RasterRenderTarget`): scanline polygon fill for
 *   `fill()`, a thick-quad rasterization of `stroke()` (only ever called for a single line
 *   segment in this module's real call pattern — see the class doc comment), and a
 *   distance-based fill for the one full-circle `arc()` call pattern.
 * - A minimal, dependency-free PNG encoder: an uncompressed ("stored" `DEFLATE` block) zlib
 *   stream wrapped in the standard PNG chunk framing (`IHDR`/`IDAT`/`IEND` with CRC-32 checksums).
 *   "Stored" DEFLATE blocks copy bytes verbatim (`RFC 1951` §3.2.4) — this keeps the encoder
 *   simple and fully deterministic without needing an LZ77/Huffman compressor, at the cost of
 *   file size (irrelevant to spec conformance, which only requires a valid, deterministic PNG).
 *
 * Determinism (`spec/rendering.md`'s "Export determinism" section, mirroring `svg.ts`): the
 * exporter only ever reads its `scene`/`state`/`viewport`/`options` arguments — no animation
 * timing, pause state, frame rate, or wall-clock time is consulted — and every rasterization and
 * encoding step here is pure arithmetic over those inputs, so the same inputs always produce a
 * byte-identical PNG. The background is always included (opaque, filled first); the avatar is
 * included only when `includeAvatar` (default `true`) says to and the turtle is visible, exactly
 * matching `svg.ts`. `includeOverlays` is accepted for API parity with `svg.ts` but is currently a
 * no-op, for the same reason: `TurtleScene` carries no overlay data yet (Geometry profile, M4).
 */

import type { Point } from "@openlogo/core";
import type { RenderTarget, Viewport } from "./canvas.js";
import { paintScene, paintTurtle } from "./canvas.js";
import type { TurtleScene } from "./scene.js";
import type { TurtleState } from "./state.js";

/** Export options, deliberately mirroring {@link SvgExportOptions} (`svg.ts`) for API parity
 * between the two export targets. */
export interface PngExportOptions {
  /** Whether to include the live turtle avatar (still gated on `state.visible`). Defaults to
   * `true`. */
  readonly includeAvatar?: boolean;
  /** Reserved for the Geometry profile's overlays (M4); currently a no-op (see the module doc
   * comment). Defaults to `true`. */
  readonly includeOverlays?: boolean;
}

/** An RGBA color, each channel `0`-`255`. */
interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/** Parses a color string into opaque RGBA. Unlike `svg.ts`'s `normalizeColor` (which can pass a
 * color string straight into markup for a native renderer to interpret), PNG export must write
 * literal RGBA bytes, so this module needs a real color parser. It supports exactly the two
 * string-valued forms `set_color`/`set_background` accept (`spec/commands.md`'s "Colors"
 * section): the full normative named-color palette (`black`, `white`, `red`, `orange`, `yellow`,
 * `green`, `blue`, `purple`, `pink`, `brown`, `gray`) and a `#rrggbb` hex word — there is no
 * shorter `#rgb` form in the spec, so none is accepted here. An `[r g b]` RGB-list color is
 * accepted by `set_color` itself, but by the time a color reaches this retained-scene reducer it
 * has already been carried as a `string` in the event payload (`packages/core/src/events.ts`);
 * how the not-yet-landed color-emitting runtime commands (#206–#210) represent an RGB-list color
 * as a string is not yet defined, so this parser does not guess at that form — it is intentionally
 * limited to the two forms actually specified as color-word syntax. Any other string (including
 * an as-yet-undefined RGB-list serialization) falls back to opaque black, deterministically. */
const NAMED_COLORS: ReadonlyMap<string, Rgba> = new Map([
  ["black", { r: 0, g: 0, b: 0, a: 255 }],
  ["white", { r: 255, g: 255, b: 255, a: 255 }],
  ["red", { r: 255, g: 0, b: 0, a: 255 }],
  ["orange", { r: 255, g: 165, b: 0, a: 255 }],
  ["yellow", { r: 255, g: 255, b: 0, a: 255 }],
  ["green", { r: 0, g: 128, b: 0, a: 255 }],
  ["blue", { r: 0, g: 0, b: 255, a: 255 }],
  ["purple", { r: 128, g: 0, b: 128, a: 255 }],
  ["pink", { r: 255, g: 192, b: 203, a: 255 }],
  ["brown", { r: 165, g: 42, b: 42, a: 255 }],
  ["gray", { r: 128, g: 128, b: 128, a: 255 }],
]);

function parseColor(color: string): Rgba {
  const normalized = color.trim().toLowerCase();
  const named = NAMED_COLORS.get(normalized);
  if (named !== undefined) {
    return named;
  }
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(normalized);
  if (hex !== null) {
    const [, r, g, b] = hex;
    return {
      r: parseInt(r as string, 16),
      g: parseInt(g as string, 16),
      b: parseInt(b as string, 16),
      a: 255,
    };
  }
  return { r: 0, g: 0, b: 0, a: 255 };
}

/** A single 2-D affine transform (`[a, b, c, d, e, f]`, matching the Canvas 2D convention:
 * `x' = a*x + c*y + e`, `y' = b*x + d*y + f`). This module's only real transform usage
 * (`paintAvatar` in `canvas.ts`: one `save → translate → rotate → draw → restore` block, never
 * nested) needs exactly one non-identity transform active at a time — so, like `svg.ts`'s
 * `SvgRenderTarget`, there is no transform stack, just the current transform. */
interface Matrix {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function applyMatrix(
  m: Matrix,
  x: number,
  y: number,
): readonly [number, number] {
  return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
}

/** Composes `m` with a translation, matching Canvas's `translate` semantics (translate happens
 * in the *current* local space). */
function translateMatrix(m: Matrix, x: number, y: number): Matrix {
  const [e, f] = applyMatrix(m, x, y);
  return { a: m.a, b: m.b, c: m.c, d: m.d, e, f };
}

/** Composes `m` with a rotation by `angleRadians`, matching Canvas's `rotate` semantics
 * (positive angle rotates clockwise in a y-down target space). */
function rotateMatrix(m: Matrix, angleRadians: number): Matrix {
  const cos = Math.cos(angleRadians);
  const sin = Math.sin(angleRadians);
  return {
    a: m.a * cos + m.c * sin,
    b: m.b * cos + m.d * sin,
    c: m.c * cos - m.a * sin,
    d: m.d * cos - m.b * sin,
    e: m.e,
    f: m.f,
  };
}

/** A `width`×`height` RGBA pixel buffer, top-left origin, row-major, 4 bytes/pixel — the
 * intermediate raster surface this module rasterizes vector geometry into before PNG encoding. */
class PixelBuffer {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }

  /** Sets one pixel to an opaque color. Both callers (`fillPolygon`/`fillCircle`) already clamp
   * their x/y ranges to `[0, width)`/`[0, height)` before calling this, so an additional
   * bounds-check here would be dead, uncoverable code rather than a real safeguard. */
  setPixel(x: number, y: number, color: Rgba): void {
    const offset = (Math.trunc(y) * this.width + Math.trunc(x)) * 4;
    this.data[offset] = color.r;
    this.data[offset + 1] = color.g;
    this.data[offset + 2] = color.b;
    this.data[offset + 3] = color.a;
  }

  /** Fills every pixel whose center falls inside the polygon described by `points` (closed
   * implicitly — the last point connects back to the first), using the standard scanline
   * even-odd rule. Sufficient for this module's simple, non-self-intersecting shapes (rectangles,
   * thick-line quads, and avatar outlines) — the "SHOULD use the nonzero winding rule"
   * recommendation (`spec/rendering.md`'s "Fill" section) only matters for self-intersecting
   * paths, which none of this module's callers produce. */
  fillPolygon(points: readonly Point[], color: Rgba): void {
    if (points.length < 3) {
      return;
    }
    const minY = Math.max(0, Math.floor(Math.min(...points.map((p) => p[1]))));
    const maxY = Math.min(
      this.height - 1,
      Math.ceil(Math.max(...points.map((p) => p[1]))),
    );
    for (let y = minY; y <= maxY; y += 1) {
      const scanY = y + 0.5;
      const intersections: number[] = [];
      for (let i = 0; i < points.length; i += 1) {
        const p1 = points[i] as Point;
        const p2 = points[(i + 1) % points.length] as Point;
        const [x1, y1] = p1;
        const [x2, y2] = p2;
        if (y1 === y2) {
          continue;
        }
        if ((scanY >= y1 && scanY < y2) || (scanY >= y2 && scanY < y1)) {
          const t = (scanY - y1) / (y2 - y1);
          intersections.push(x1 + t * (x2 - x1));
        }
      }
      intersections.sort((left, right) => left - right);
      for (let i = 0; i + 1 < intersections.length; i += 2) {
        const startX = Math.max(0, Math.round(intersections[i] as number));
        const endX = Math.min(
          this.width - 1,
          Math.round(intersections[i + 1] as number) - 1,
        );
        for (let x = startX; x <= endX; x += 1) {
          this.setPixel(x, y, color);
        }
      }
    }
  }

  /** Fills every pixel whose center falls within `radius` of `(cx, cy)` — a simple, deterministic
   * (non-antialiased) disc fill for the one full-circle avatar shape. */
  fillCircle(cx: number, cy: number, radius: number, color: Rgba): void {
    const minX = Math.max(0, Math.floor(cx - radius));
    const maxX = Math.min(this.width - 1, Math.ceil(cx + radius));
    const minY = Math.max(0, Math.floor(cy - radius));
    const maxY = Math.min(this.height - 1, Math.ceil(cy + radius));
    const radiusSquared = radius * radius;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= radiusSquared) {
          this.setPixel(x, y, color);
        }
      }
    }
  }
}

/** Builds the four-corner quad of a straight, capless thick line from `from` to `to` with the
 * given `width` — used to rasterize `stroke()`. Returns `null` for a zero-length segment (no
 * direction to offset perpendicular to), which this module then consistently omits, one of the
 * two spec-permitted consistent treatments for a zero-length segment
 * (`spec/rendering.md`'s "Line segments" section). */
function thickLineQuad(
  from: Point,
  to: Point,
  width: number,
): readonly Point[] | null {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  if (length === 0) {
    return null;
  }
  const halfWidth = width / 2;
  const nx = (-dy / length) * halfWidth;
  const ny = (dx / length) * halfWidth;
  return [
    [from[0] + nx, from[1] + ny],
    [to[0] + nx, to[1] + ny],
    [to[0] - nx, to[1] - ny],
    [from[0] - nx, from[1] - ny],
  ];
}

/**
 * A `RenderTarget` that rasterizes draw calls into a {@link PixelBuffer} instead of a live canvas
 * or SVG markup string. Scoped to the same reduced call-pattern assumptions as `svg.ts`'s
 * `SvgRenderTarget`: exactly one non-nested `save → translate → rotate → shape → restore` block
 * per avatar/stamp, `stroke()` always draws a single two-point line segment (the only path
 * `paintScene` ever strokes), `fill()` always fills either a recorded circle or a closed polygon,
 * and `arc()` is always a full circle.
 */
class RasterRenderTarget implements RenderTarget {
  fillStyle = "";
  strokeStyle = "";
  lineWidth = 1;

  private readonly buffer: PixelBuffer;
  private transform: Matrix = IDENTITY;
  private pathPoints: Point[] = [];
  private circle: {
    readonly x: number;
    readonly y: number;
    readonly r: number;
  } | null = null;

  constructor(width: number, height: number) {
    this.buffer = new PixelBuffer(width, height);
  }

  save(): void {
    // No-op: see the class doc comment — every `save` is matched by exactly one `restore` with
    // no nesting, so there is no stack to maintain.
  }

  restore(): void {
    this.transform = IDENTITY;
  }

  translate(x: number, y: number): void {
    this.transform = translateMatrix(this.transform, x, y);
  }

  rotate(angleRadians: number): void {
    this.transform = rotateMatrix(this.transform, angleRadians);
  }

  beginPath(): void {
    this.pathPoints = [];
    this.circle = null;
  }

  closePath(): void {
    // The path is always implicitly closed by `fillPolygon`/the quad construction; explicit
    // closing adds no new point.
  }

  moveTo(x: number, y: number): void {
    this.pathPoints.push(applyMatrix(this.transform, x, y));
  }

  lineTo(x: number, y: number): void {
    this.pathPoints.push(applyMatrix(this.transform, x, y));
  }

  arc(x: number, y: number, radius: number): void {
    // Only ever called for the "circle" avatar shape's full circle (see the class doc comment).
    const [cx, cy] = applyMatrix(this.transform, x, y);
    this.circle = { x: cx, y: cy, r: radius };
  }

  // `stroke()` assumes exactly a 2-point path: every caller in this module's actual usage
  // (`paintScene`/`paintAvatar` in `canvas.ts`) always issues `beginPath()` + `moveTo` + exactly
  // one `lineTo()` before stroking. There is no caller that strokes an empty or single-point
  // path, so a defensive guard here would be dead, uncoverable code rather than a real
  // safeguard (matching `svg.ts`'s identical, already-reviewed assumption).
  stroke(): void {
    const [from, to] = this.pathPoints as [Point, Point];
    const quad = thickLineQuad(from, to, this.lineWidth);
    if (quad === null) {
      return;
    }
    this.buffer.fillPolygon(quad, parseColor(this.strokeStyle));
  }

  fill(): void {
    if (this.circle !== null) {
      const { x, y, r } = this.circle;
      this.buffer.fillCircle(x, y, r, parseColor(this.fillStyle));
      return;
    }
    this.buffer.fillPolygon(this.pathPoints, parseColor(this.fillStyle));
  }

  fillRect(x: number, y: number, width: number, height: number): void {
    this.buffer.fillPolygon(
      [
        [x, y],
        [x + width, y],
        [x + width, y + height],
        [x, y + height],
      ],
      parseColor(this.fillStyle),
    );
  }

  toPixelBuffer(): PixelBuffer {
    return this.buffer;
  }
}

// --- Minimal, dependency-free PNG encoding -------------------------------------------------

/** Standard CRC-32 lookup table (`RFC 1952` §8), built once and reused for every chunk. */
const CRC_TABLE: readonly number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table.push(c >>> 0);
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  const MOD_ADLER = 65521;
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % MOD_ADLER;
    b = (b + a) % MOD_ADLER;
  }
  return ((b << 16) | a) >>> 0;
}

function writeUint32BE(value: number): Uint8Array {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/** Wraps `data` in a minimal zlib stream (`RFC 1950`) using only uncompressed ("stored")
 * `DEFLATE` blocks (`RFC 1951` §3.2.4) — see the module doc comment for why no LZ77/Huffman
 * compression is implemented. Each stored block is byte-aligned (a stored block's 3-bit header
 * plus 5 padding bits is exactly one byte, and its raw data is already byte data), so this needs
 * no bit-level buffering at all. */
function zlibStore(data: Uint8Array): Uint8Array {
  const MAX_STORED_BLOCK = 65535;
  const blocks: Uint8Array[] = [];
  let offset = 0;
  do {
    const remaining = data.length - offset;
    const blockLength = Math.min(remaining, MAX_STORED_BLOCK);
    const isFinal = offset + blockLength >= data.length;
    const header = new Uint8Array(5);
    header[0] = isFinal ? 1 : 0;
    header[1] = blockLength & 0xff;
    header[2] = (blockLength >>> 8) & 0xff;
    const notLength = ~blockLength & 0xffff;
    header[3] = notLength & 0xff;
    header[4] = (notLength >>> 8) & 0xff;
    blocks.push(header, data.subarray(offset, offset + blockLength));
    offset += blockLength;
  } while (offset < data.length);
  const zlibHeader = new Uint8Array([0x78, 0x01]);
  const checksum = writeUint32BE(adler32(data));
  return concatBytes([zlibHeader, ...blocks, checksum]);
}

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new Uint8Array(
    type.split("").map((char) => char.charCodeAt(0)),
  );
  const length = writeUint32BE(data.length);
  const crc = writeUint32BE(crc32(concatBytes([typeBytes, data])));
  return concatBytes([length, typeBytes, data, crc]);
}

/** Encodes a {@link PixelBuffer} (8-bit RGBA, no interlacing) as a complete PNG byte stream:
 * signature, `IHDR`, one `IDAT` (filter type `0` "None" per scanline, per `RFC 2083`), `IEND`. */
function encodePng(buffer: PixelBuffer): Uint8Array {
  const ihdrData = concatBytes([
    writeUint32BE(buffer.width),
    writeUint32BE(buffer.height),
    new Uint8Array([8, 6, 0, 0, 0]), // bit depth 8, color type 6 (RGBA), default compression/filter/interlace
  ]);

  const scanlineLength = buffer.width * 4;
  const raw = new Uint8Array((scanlineLength + 1) * buffer.height);
  for (let y = 0; y < buffer.height; y += 1) {
    const rowStart = y * (scanlineLength + 1);
    raw[rowStart] = 0; // filter type 0: None
    raw.set(
      buffer.data.subarray(y * scanlineLength, (y + 1) * scanlineLength),
      rowStart + 1,
    );
  }

  return concatBytes([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdrData),
    pngChunk("IDAT", zlibStore(raw)),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
}

/**
 * Exports the retained scene (and, by default, the visible avatar) as a deterministic PNG image
 * — rasterized through exactly the same `RenderTarget`-driven `paintTurtle`/`paintScene`
 * orchestration as `exportTurtleSvg` (`svg.ts`, #215) and `paintTurtle`/`paintScene` themselves
 * (`canvas.ts`, #214). Returns the raw PNG bytes.
 */
export function exportTurtlePng(
  scene: TurtleScene,
  state: TurtleState,
  viewport: Viewport,
  options: PngExportOptions = {},
): Uint8Array {
  const includeAvatar = options.includeAvatar ?? true;
  const target = new RasterRenderTarget(viewport.width, viewport.height);
  if (includeAvatar) {
    paintTurtle(target, scene, state, viewport);
  } else {
    paintScene(target, scene, viewport);
  }
  return encodePng(target.toPixelBuffer());
}
