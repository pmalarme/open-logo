/**
 * The Canvas live renderer: paints the retained {@link TurtleScene} (`scene.ts`) plus the
 * turtle avatar from {@link TurtleState} (`state.ts`) onto a 2-D drawing surface
 * (`spec/rendering.md`'s "Rendering targets", "Drawing model", "Coordinate mapping and
 * viewport", and "Turtle avatar and shapes" sections).
 *
 * This module never touches the DOM or a real `CanvasRenderingContext2D` directly. It draws
 * through {@link RenderTarget}, a minimal structural subset of the Canvas 2D drawing API, so the
 * renderer stays headless and dependency-injectable: production code passes a thin adapter over
 * a real canvas context; tests pass a small recording fake and assert the exact draw-call
 * sequence. No `lib.dom` types and no `node-canvas` dependency are introduced.
 *
 * Repainting always happens from the retained scene alone — the program is never re-run
 * (`spec/rendering.md`'s "Drawing model": "Repainting a target MUST be possible from retained
 * scene data without re-running the program"). Draw order is normative: background, then
 * drawing items in execution order, then the visible turtle avatar (overlays are a later
 * Canvas-epic slice, out of scope here).
 */

import type { Point } from "@openlogo/core";
import type { SceneItem, TurtleScene } from "./scene.js";
import type { TurtleState } from "./state.js";

/**
 * The minimal structural subset of the Canvas 2D drawing API this renderer needs. This package
 * has no `dom` lib and no `node-canvas` dependency, so `RenderTarget` is our own hand-written
 * interface rather than `CanvasRenderingContext2D` — production integrations (Studio) pass a
 * thin adapter over a real 2-D context (a later slice, since `CanvasRenderingContext2D.fillStyle`
 * / `strokeStyle` accept `CanvasGradient`/`CanvasPattern` in addition to `string`, so a real
 * context is not directly assignable without narrowing); tests supply a recording fake that
 * implements this interface exactly, with no DOM at all.
 */
export interface RenderTarget {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(angleRadians: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  fill(): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
  ): void;
}

/**
 * The target's pixel size and the world-to-target scale. `centerX`/`centerY` default to the
 * middle of the target — an unpanned viewport — matching `spec/rendering.md`'s "default scale
 * SHOULD be `1` world unit per CSS pixel". Pan/zoom (a view-only transform that must never
 * change program-visible coordinates or the retained scene) is deferred to a later slice; this
 * viewport is always unpanned, centered, and un-zoomed.
 */
export interface Viewport {
  readonly width: number;
  readonly height: number;
  /** World units per target pixel; defaults to `1`. Also applied to pen width, per
   * `spec/rendering.md`: "A target maps width through the same viewport scale used for
   * coordinates." */
  readonly scale?: number;
}

const DEFAULT_SCALE = 1;

/** The turtle avatar's presentation size, in world units. A presentation detail only — it must
 * never affect turtle coordinates, line geometry, or exports (`spec/rendering.md`: "Shape size
 * is a renderer presentation property"). */
const AVATAR_SIZE = 10;

/**
 * Maps one world-space point to target pixel coordinates for an unpanned viewport
 * (`spec/rendering.md`'s "Coordinate mapping and viewport": `target x = center x + world x ×
 * scale`, `target y = center y − world y × scale` — the y-axis inversion is required because
 * world `+y` is up while target pixels count down).
 */
export function worldToTarget(
  point: Point,
  viewport: Viewport,
): readonly [number, number] {
  const scale = viewport.scale ?? DEFAULT_SCALE;
  const centerX = viewport.width / 2;
  const centerY = viewport.height / 2;
  const [worldX, worldY] = point;
  return [centerX + worldX * scale, centerY - worldY * scale];
}

const DEGREES_TO_RADIANS = Math.PI / 180;

/**
 * Walks backward from just before `beforeIndex` collecting the contiguous chain of segments
 * that form the turtle's currently enclosed path (`spec/rendering.md`'s "Fill" section: `fill`
 * "fills the currently enclosed region associated with the active turtle's drawn path"). A
 * segment belongs to the chain only while its `to` matches the next segment's `from` walking
 * forward — any discontinuity (a pen-up jump, a different item, or the start of the scene) ends
 * the chain. Assumes a single active turtle; multi-turtle scenes are the Sprites profile's
 * concern, deferred to a later slice.
 */
function collectFillPath(
  items: readonly SceneItem[],
  beforeIndex: number,
): Point[] {
  // Walk backward collecting the contiguous chain of segments, tracking `chainEnd` — the
  // `to` of the most recently accepted (i.e. chronologically latest) segment in the chain —
  // so each earlier segment is only accepted while its own `to` feeds into that point,
  // matching forward chronological continuity (`segment[i].to === segment[i + 1].from`).
  const segments: Array<readonly [Point, Point]> = [];
  let chainEnd: Point | undefined;
  let index = beforeIndex - 1;
  while (index >= 0) {
    const item = items[index];
    if (item === undefined || item.kind !== "segment") {
      break;
    }
    const { from, to } = item.segment;
    if (
      chainEnd !== undefined &&
      (to[0] !== chainEnd[0] || to[1] !== chainEnd[1])
    ) {
      break;
    }
    segments.unshift([from, to]);
    chainEnd = from;
    index -= 1;
  }
  const points: Point[] = [];
  segments.forEach(([from, to], segmentIndex) => {
    if (segmentIndex === 0) {
      points.push(from);
    }
    points.push(to);
  });
  return points;
}

/** Recognized avatar shape words (`spec/rendering.md`: "SHOULD support a small portable set
 * such as `"turtle"`, `"triangle"`, `"arrow"`, and `"circle"`"). Any other shape word — already
 * validated as a command-level error elsewhere — falls back to the default `"turtle"` look
 * rather than throwing a renderer-local diagnostic. */
type KnownShape = "turtle" | "triangle" | "arrow" | "circle";

function isKnownShape(shape: string): shape is KnownShape {
  return (
    shape === "turtle" ||
    shape === "triangle" ||
    shape === "arrow" ||
    shape === "circle"
  );
}

/**
 * Draws one avatar shape centered at the origin of the current (already translated + rotated)
 * transform, nose pointing toward local `-y` — which is "up" in target-pixel space, matching
 * heading `0°` pointing up once the caller has rotated by the heading (`spec/rendering.md`:
 * "The avatar MUST be positioned at the turtle's world position and rotated so heading `0°`
 * points upward"). `"turtle"` (the implementation-defined default) reuses the `"triangle"`
 * outline for simplicity (KISS) — the spec leaves its exact look implementation-defined.
 */
function drawShapeOutline(target: RenderTarget, shape: string): void {
  const resolved: KnownShape = isKnownShape(shape) ? shape : "turtle";
  if (resolved === "circle") {
    target.beginPath();
    target.arc(0, 0, AVATAR_SIZE / 2, 0, 2 * Math.PI);
    target.fill();
    return;
  }
  if (resolved === "arrow") {
    target.beginPath();
    target.moveTo(0, -AVATAR_SIZE);
    target.lineTo(AVATAR_SIZE * 0.6, AVATAR_SIZE * 0.5);
    target.lineTo(0, AVATAR_SIZE * 0.2);
    target.lineTo(-AVATAR_SIZE * 0.6, AVATAR_SIZE * 0.5);
    target.closePath();
    target.fill();
    return;
  }
  // "triangle" and the "turtle" default.
  target.beginPath();
  target.moveTo(0, -AVATAR_SIZE);
  target.lineTo(AVATAR_SIZE * 0.6, AVATAR_SIZE * 0.6);
  target.lineTo(-AVATAR_SIZE * 0.6, AVATAR_SIZE * 0.6);
  target.closePath();
  target.fill();
}

/**
 * Paints one avatar (the live turtle avatar or a retained `stamp`) at `position`/`heading`,
 * filled with `color`, on the target — `save`/`restore` bracket the transform so later draws
 * are unaffected.
 */
function paintAvatar(
  target: RenderTarget,
  viewport: Viewport,
  position: Point,
  heading: number,
  shape: string,
  color: string,
): void {
  const [screenX, screenY] = worldToTarget(position, viewport);
  target.save();
  target.translate(screenX, screenY);
  target.rotate(heading * DEGREES_TO_RADIANS);
  target.fillStyle = color;
  drawShapeOutline(target, shape);
  target.restore();
}

/**
 * Repaints the target from the retained scene alone: background, then each drawing item in
 * execution order (a `draw-segment` strokes a line with the color/width captured in that
 * segment; a `fill` fills the enclosed path formed by the immediately preceding contiguous
 * segments; a `stamp` paints a fixed avatar at its own recorded position/heading/shape/color).
 * Never re-runs the program and never reads live turtle state — that is {@link paintTurtle}'s
 * job, layered on top.
 */
export function paintScene(
  target: RenderTarget,
  scene: TurtleScene,
  viewport: Viewport,
): void {
  target.fillStyle = scene.background;
  target.fillRect(0, 0, viewport.width, viewport.height);

  scene.items.forEach((item, index) => {
    if (item.kind === "segment") {
      const [fromX, fromY] = worldToTarget(item.segment.from, viewport);
      const [toX, toY] = worldToTarget(item.segment.to, viewport);
      target.strokeStyle = item.segment.color;
      target.lineWidth = item.segment.width * (viewport.scale ?? DEFAULT_SCALE);
      target.beginPath();
      target.moveTo(fromX, fromY);
      target.lineTo(toX, toY);
      target.stroke();
      return;
    }
    if (item.kind === "fill") {
      const path = collectFillPath(scene.items, index);
      if (path.length < 2) {
        return;
      }
      target.fillStyle = item.fill.color;
      target.beginPath();
      const [startX, startY] = worldToTarget(path[0] as Point, viewport);
      target.moveTo(startX, startY);
      for (const point of path.slice(1)) {
        const [x, y] = worldToTarget(point, viewport);
        target.lineTo(x, y);
      }
      target.closePath();
      target.fill();
      return;
    }
    // item.kind === "stamp"
    paintAvatar(
      target,
      viewport,
      item.stamp.position,
      item.stamp.heading,
      item.stamp.shape,
      item.stamp.color,
    );
  });
}

/**
 * Repaints the whole target: the retained scene (background + drawing items), then the live
 * turtle avatar on top — but only when `state.visible` (`spec/rendering.md`: "A hidden turtle
 * still moves, turns, draws when the pen is down, and reports its state normally" — hiding it
 * only omits the avatar, never the scene). This is the renderer's one public entry point for a
 * full repaint; production code calls it with a real Canvas 2D context, tests with a recording
 * fake, both satisfying {@link RenderTarget} structurally.
 */
export function paintTurtle(
  target: RenderTarget,
  scene: TurtleScene,
  state: TurtleState,
  viewport: Viewport,
): void {
  paintScene(target, scene, viewport);
  if (state.visible) {
    paintAvatar(
      target,
      viewport,
      state.position,
      state.heading,
      state.shape,
      state.color,
    );
  }
}
