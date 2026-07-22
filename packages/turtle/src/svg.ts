/**
 * Deterministic SVG export: serializes the retained {@link TurtleScene} (`scene.ts`) plus the
 * turtle avatar from {@link TurtleState} (`state.ts`) as a vector SVG document
 * (`spec/rendering.md`'s "Rendering targets" and "Export determinism" sections).
 *
 * Rather than re-implementing the coordinate mapping, draw order, or shape geometry a second
 * time, this module reuses the **same** {@link RenderTarget} abstraction, {@link worldToTarget}
 * mapping, and `paintScene`/`paintTurtle` orchestration introduced for the Canvas live renderer
 * (`canvas.ts`, #214): {@link SvgRenderTarget} is simply another `RenderTarget` implementation
 * that records draw calls as SVG markup instead of mutating a live canvas. This keeps SVG and
 * Canvas output structurally guaranteed to agree on "the same world-to-target coordinate mapping
 * as Canvas" (`spec/rendering.md`'s SVG-export acceptance criterion) — there is exactly one
 * mapping and one draw-order implementation, not two to keep in sync.
 *
 * Determinism (`spec/rendering.md`'s "Export determinism" section — "Exporters MUST: consume
 * the completed retained scene …; use the same viewport mapping for all drawing items; preserve
 * draw order; serialize colors in a deterministic normalized form; serialize numeric coordinates
 * with a documented stable precision; include the background by default; include or exclude
 * overlays according to a documented deterministic option; include the visible turtle avatar
 * only when the export option says to include it and the turtle is visible"):
 *
 * - The exporter only ever reads its `scene`/`state`/`viewport`/`options` arguments — no
 *   animation timing, pause state, frame rate, or wall-clock time is consulted, so the same
 *   inputs always produce byte-identical output.
 * - Colors are normalized via {@link normalizeColor} (trimmed, lower-cased) before serialization,
 *   so `" Red "` and `"red"` always serialize identically.
 * - Numeric coordinates are serialized with a fixed, documented precision
 *   ({@link COORDINATE_PRECISION} decimal places) via {@link formatNumber}.
 * - The background is always included (there is no option to omit it, matching "include the
 *   background by default").
 * - `includeOverlays` (default `true`) controls whether enabled overlays (`grid`/`axes`/
 *   `measure`, folded by `overlay.ts`'s `reduceOverlayEvents`) are painted before the avatar —
 *   `spec/geometry-module.md:300`: "not part of exported drawing geometry unless an export format
 *   explicitly includes overlays." When the caller passes no `overlay` argument (or omits overlay
 *   data entirely), there is nothing to include either way.
 * - `includeAvatar` (default `true`) is the "export option [that] says to include it"; when
 *   `true`, the avatar is still only drawn if `state.visible` (delegated to `paintTurtle`,
 *   unchanged from Canvas); when `false`, the avatar is omitted regardless of visibility.
 */

import type { RenderTarget, Viewport } from "./canvas.js";
import { paintScene, paintTurtle } from "./canvas.js";
import { INITIAL_OVERLAY_STATE, type OverlayState } from "./overlay.js";
import type { TurtleScene } from "./scene.js";
import type { TurtleState } from "./state.js";

/** Decimal places used for every serialized numeric coordinate, width, and transform value —
 * the "documented stable precision" `spec/rendering.md`'s Export determinism section requires. */
const COORDINATE_PRECISION = 3;

function formatNumber(value: number): string {
  return value.toFixed(COORDINATE_PRECISION);
}

/**
 * The "documented, deterministic normalized color form" `spec/rendering.md` requires: trims
 * surrounding whitespace and lower-cases the value, so equivalent CSS color strings (e.g.
 * `" Red "` and `"red"`, or `"#FF0000"` and `"#ff0000"`) always serialize identically.
 */
function normalizeColor(color: string): string {
  return color.trim().toLowerCase();
}

/**
 * Export options controlling optional SVG content. Both default to including the content, since
 * `spec/rendering.md` says the background is included by default and the avatar is included
 * "only when the export option says to include it and the turtle is visible" — the natural
 * default for a plain export is to show everything currently visible.
 */
export interface SvgExportOptions {
  /** Whether to include the live turtle avatar (still gated on `state.visible`). Defaults to
   * `true`. */
  readonly includeAvatar?: boolean;
  /** Whether to include enabled overlays (`grid`/`axes`/`measure`), when overlay data is passed
   * to {@link exportTurtleSvg}. Defaults to `true`. */
  readonly includeOverlays?: boolean;
}

/**
 * A `RenderTarget` that records draw calls as SVG markup instead of a live canvas. Its usage is
 * scoped entirely to how `canvas.ts`'s `paintScene`/`paintTurtle` call a `RenderTarget`: exactly
 * one un-nested `save → translate → rotate → shape → restore` block per avatar/stamp, and no
 * arc calls other than a full circle (0 to 2π, from the `"circle"` shape) — so this
 * implementation deliberately does not support arbitrary nested transforms or partial arcs; it
 * only needs to support the calls `paintScene`/`paintTurtle` actually make.
 */
class SvgRenderTarget implements RenderTarget {
  fillStyle = "";
  strokeStyle = "";
  lineWidth = 1;

  private readonly elements: string[] = [];
  private transform: string | null = null;
  private pathCommands: string[] = [];
  private circle: {
    readonly x: number;
    readonly y: number;
    readonly r: number;
  } | null = null;

  save(): void {
    // No-op: every `save` in this module's call patterns is matched by exactly one `restore`
    // with no nesting, so there is no stack to maintain (see the class doc comment).
  }

  restore(): void {
    this.transform = null;
  }

  // `translate`/`rotate` always compose onto the current transform string. In this module's
  // only actual call pattern (`paintAvatar` in `canvas.ts`: `save → translate → rotate → draw →
  // restore`), `translate` is always the first call after a `restore` (so `this.transform` is
  // always `null` at that point) and `rotate` always follows a `translate` (so it always
  // appends). A conditional "first call vs. append" branch would therefore be dead, uncoverable
  // code rather than a real safeguard — this class only needs to support the calls it actually
  // receives (see the class doc comment).

  translate(x: number, y: number): void {
    this.transform = `translate(${formatNumber(x)} ${formatNumber(y)})`;
  }

  rotate(angleRadians: number): void {
    const degrees = (angleRadians * 180) / Math.PI;
    const part = `rotate(${formatNumber(degrees)})`;
    this.transform = `${this.transform} ${part}`;
  }

  beginPath(): void {
    this.pathCommands = [];
    this.circle = null;
  }

  closePath(): void {
    this.pathCommands.push("Z");
  }

  moveTo(x: number, y: number): void {
    this.pathCommands.push(`M ${formatNumber(x)} ${formatNumber(y)}`);
  }

  lineTo(x: number, y: number): void {
    this.pathCommands.push(`L ${formatNumber(x)} ${formatNumber(y)}`);
  }

  arc(x: number, y: number, radius: number): void {
    // Only ever called for the "circle" avatar shape's full circle; recorded separately from
    // `pathCommands` so `fill()` can emit a `<circle>` element instead of a `<path>`.
    this.circle = { x, y, r: radius };
  }

  private transformAttr(): string {
    return this.transform === null ? "" : ` transform="${this.transform}"`;
  }

  // `stroke()`/`fill()` assume a non-empty path (or, for `fill()`, a recorded circle): every
  // caller in this module's actual usage (`paintScene`/`paintAvatar` in `canvas.ts`) always
  // issues `beginPath()` + at least one `moveTo`/`lineTo`/`arc` before drawing. There is no
  // caller that strokes/fills an empty path, so an empty-path guard here would be dead,
  // uncoverable code rather than a real safeguard.

  stroke(): void {
    const d = this.pathCommands.join(" ");
    this.elements.push(
      `<path d="${d}" fill="none" stroke="${normalizeColor(this.strokeStyle)}" stroke-width="${formatNumber(this.lineWidth)}"${this.transformAttr()}/>`,
    );
  }

  fill(): void {
    if (this.circle !== null) {
      const { x, y, r } = this.circle;
      this.elements.push(
        `<circle cx="${formatNumber(x)}" cy="${formatNumber(y)}" r="${formatNumber(r)}" fill="${normalizeColor(this.fillStyle)}"${this.transformAttr()}/>`,
      );
      return;
    }
    const d = this.pathCommands.join(" ");
    this.elements.push(
      `<path d="${d}" fill="${normalizeColor(this.fillStyle)}"${this.transformAttr()}/>`,
    );
  }

  fillRect(x: number, y: number, width: number, height: number): void {
    this.elements.push(
      `<rect x="${formatNumber(x)}" y="${formatNumber(y)}" width="${formatNumber(width)}" height="${formatNumber(height)}" fill="${normalizeColor(this.fillStyle)}"/>`,
    );
  }

  toMarkup(viewport: Viewport): string {
    // `elements` always has at least the background `<rect>` (both `paintScene` and
    // `paintTurtle` always draw the background first), so `body` is never empty here — no
    // empty-body branch is needed.
    const body = this.elements.map((element) => `  ${element}`).join("\n");
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${viewport.width}" height="${viewport.height}" viewBox="0 0 ${viewport.width} ${viewport.height}">\n` +
      `${body}\n` +
      `</svg>\n`
    );
  }
}

/**
 * Exports the retained scene (and, by default, the visible avatar) as a deterministic SVG
 * document string, using exactly the same coordinate mapping and draw order as
 * `paintTurtle`/`paintScene` (`canvas.ts`, #214) — see the module doc comment for the full
 * determinism rationale.
 */
export function exportTurtleSvg(
  scene: TurtleScene,
  state: TurtleState,
  viewport: Viewport,
  options: SvgExportOptions = {},
  overlay: OverlayState = INITIAL_OVERLAY_STATE,
): string {
  const includeAvatar = options.includeAvatar ?? true;
  const includeOverlays = options.includeOverlays ?? true;
  const paintedOverlay = includeOverlays ? overlay : undefined;
  const target = new SvgRenderTarget();
  if (includeAvatar) {
    paintTurtle(target, scene, state, viewport, paintedOverlay);
  } else {
    paintScene(target, scene, viewport, paintedOverlay);
  }
  return target.toMarkup(viewport);
}
