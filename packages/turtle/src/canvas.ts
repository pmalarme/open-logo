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
 * drawing items in execution order, then overlays, then the visible turtle avatar
 * (`spec/rendering.md:32`: "The logical draw order is background first, then drawing items in
 * execution order, then overlays, then the visible turtle avatar").
 */

import type { Point } from "@openlogo/core";
import type { AnimationSnapshot } from "./animation.js";
import type { GridOverlay, OverlayState } from "./overlay.js";
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

/**
 * The backing-store pixel size and the {@link Viewport} to paint through so the Canvas surface
 * stays crisp when it is displayed larger than its default design size, or on a high-DPI display,
 * **without moving a single world coordinate** (#474 — `spec/rendering.md`'s "Coordinate mapping
 * and viewport": pan/zoom-style view transforms "MUST NOT change the retained scene, turtle
 * coordinates, exported world geometry, or program-visible values").
 *
 * `backingPixels` is what the DOM `<canvas>`'s `width`/`height` (its device-pixel backing store)
 * should be set to; `viewport` is what {@link paintTurtle}/{@link paintScene} paint through. Its
 * `scale` (target pixels per world unit — also applied to pen width, `spec/rendering.md`'s
 * "Width") is chosen as `backingPixels / referenceSize` so the fixed `referenceSize` world extent
 * always fills the backing store identically at any resolution.
 */
export interface BackingResolution {
  /** The device-pixel backing size to assign to the canvas's `width`/`height`. Always `>= 1`. */
  readonly backingPixels: number;
  /** The square viewport (`width === height === backingPixels`) and its world-to-target scale. */
  readonly viewport: Viewport;
}

/** Returns `value` when it is a finite positive number, otherwise `fallback`. Guards the two
 * DOM-sourced inputs of {@link resolveBackingResolution} (`renderedCssSize`, `devicePixelRatio`),
 * which can legitimately be `0`/`NaN` before layout settles or in headless environments. */
function finitePositiveOr(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Compute the DPR-aware backing resolution for a **square** Canvas surface (#474). Pure scale math
 * only — no DOM: the caller (studio) reads `renderedCssSize` (the canvas's rendered CSS width) and
 * `devicePixelRatio` from the browser and applies the returned `backingPixels`/`viewport`.
 *
 * The world-to-target mapping is invariant across resolutions: because `scale =
 * backingPixels / referenceSize` and the viewport is `backingPixels` wide, every world point's
 * *normalized* target position — `worldToTarget(point) / backingPixels` — reduces to
 * `0.5 + worldX / referenceSize` (and `0.5 - worldY / referenceSize`), which depends only on the
 * fixed `referenceSize`, never on `renderedCssSize` or `devicePixelRatio`. Enlarging the canvas or
 * moving to a HiDPI display therefore adds raster pixels without any geometry drift; at
 * `renderedCssSize === referenceSize` and `devicePixelRatio === 1` the result is the unchanged
 * default (`backingPixels === referenceSize`, `scale === 1`).
 *
 * @throws RangeError if `referenceSize` is not a finite positive number (an internal design
 *   constant, so an invalid value is a programming error rather than transient DOM state).
 */
export function resolveBackingResolution(options: {
  /** The design reference extent, in CSS pixels — the canvas's default square backing size. */
  readonly referenceSize: number;
  /** The canvas's current rendered CSS width, in CSS pixels. */
  readonly renderedCssSize: number;
  /** The display's `window.devicePixelRatio`. */
  readonly devicePixelRatio: number;
}): BackingResolution {
  const { referenceSize } = options;
  if (!(Number.isFinite(referenceSize) && referenceSize > 0)) {
    throw new RangeError(
      `resolveBackingResolution: referenceSize must be a finite positive number, got ${referenceSize}`,
    );
  }
  const devicePixelRatio = finitePositiveOr(options.devicePixelRatio, 1);
  const renderedCssSize = finitePositiveOr(
    options.renderedCssSize,
    referenceSize,
  );
  const backingPixels = Math.max(
    1,
    Math.round(renderedCssSize * devicePixelRatio),
  );
  const scale = backingPixels / referenceSize;
  return {
    backingPixels,
    viewport: { width: backingPixels, height: backingPixels, scale },
  };
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
 * The `"turtle"` default avatar's outline: a twelve-point polygon silhouette of a turtle seen
 * from above — a head at the nose, four leg bumps (front-left/front-right/back-left/back-right),
 * and a tail tip at the rear — so the default glyph is a literal turtle rather than a bare
 * triangle/arrow (`spec/rendering.md`: "The default avatar shape is an implementation-defined
 * turtle-like shape whose nose points along the turtle heading"; the spec leaves the exact look
 * implementation-defined). Expressed as plain `moveTo`/`lineTo` pairs — no curves — so both the
 * Canvas and SVG `RenderTarget` implementations render it identically (`svg.ts`'s
 * `SvgRenderTarget` only special-cases the `"circle"` shape's `arc` call).
 * Coordinates are fractions of {@link AVATAR_SIZE}, nose at local `(0, -AVATAR_SIZE)` matching
 * the other shapes.
 */
const TURTLE_OUTLINE_POINTS: ReadonlyArray<readonly [number, number]> = [
  [0, -1], // nose (head tip)
  [0.4, -0.6], // head, right shoulder
  [0.7, -0.6], // front-right leg
  [0.4, -0.3],
  [0.7, 0.3], // back-right leg
  [0.4, 0.6],
  [0, 0.9], // tail tip
  [-0.4, 0.6],
  [-0.7, 0.3], // back-left leg
  [-0.4, -0.3],
  [-0.7, -0.6], // front-left leg
  [-0.4, -0.6], // head, left shoulder
];

/**
 * Draws one avatar shape centered at the origin of the current (already translated + rotated)
 * transform, nose pointing toward local `-y` — which is "up" in target-pixel space, matching
 * heading `0°` pointing up once the caller has rotated by the heading (`spec/rendering.md`:
 * "The avatar MUST be positioned at the turtle's world position and rotated so heading `0°`
 * points upward").
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
  if (resolved === "triangle") {
    target.beginPath();
    target.moveTo(0, -AVATAR_SIZE);
    target.lineTo(AVATAR_SIZE * 0.6, AVATAR_SIZE * 0.6);
    target.lineTo(-AVATAR_SIZE * 0.6, AVATAR_SIZE * 0.6);
    target.closePath();
    target.fill();
    return;
  }
  // "turtle" (the default): a real turtle silhouette, not a bare triangle/arrow.
  target.beginPath();
  TURTLE_OUTLINE_POINTS.forEach(([fractionX, fractionY], index) => {
    const x = fractionX * AVATAR_SIZE;
    const y = fractionY * AVATAR_SIZE;
    if (index === 0) {
      target.moveTo(x, y);
    } else {
      target.lineTo(x, y);
    }
  });
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

/** Grid overlay guide-line color (`spec/rendering.md:139`: color must not be the sole carrier —
 * see {@link AXES_STROKE_STYLE}'s distinct width for how the axes overlay stays distinguishable
 * without relying on color alone). */
const GRID_STROKE_STYLE = "#cccccc";
/** Grid guide lines are thin — distinguishable from the bolder axes overlay by width, not just
 * color. */
const GRID_LINE_WIDTH = 1;

/** Axes overlay line color, deliberately distinct from {@link GRID_STROKE_STYLE}. */
const AXES_STROKE_STYLE = "#888888";
/** Axes lines are drawn bolder than grid lines — a non-color (width) distinction, per
 * `spec/rendering.md:139` ("axes can use labels or line patterns"). */
const AXES_LINE_WIDTH = 2;

/** `measure` overlay marker color and size, in world units before viewport scaling. */
const MEASURE_STROKE_STYLE = "#ff8800";
const MEASURE_MARKER_RADIUS = 4;

/**
 * The multiples of `spacing` that fall within `[minValue, maxValue]`, ascending — shared by
 * {@link paintOverlay}'s grid vertical/horizontal line generation. Returns `[]` when `spacing`
 * is not a positive finite number, so a malformed grid spacing degrades to "no lines" rather
 * than looping forever.
 */
function multiplesInRange(
  spacing: number,
  minValue: number,
  maxValue: number,
): number[] {
  if (!Number.isFinite(spacing) || spacing <= 0) {
    return [];
  }
  const values: number[] = [];
  const start = Math.ceil(minValue / spacing) * spacing;
  for (let value = start; value <= maxValue; value += spacing) {
    values.push(value);
  }
  return values;
}

/**
 * Draws the grid overlay's guide lines: vertical lines at every world-x multiple of
 * `grid.spacing`, horizontal lines at every world-y multiple, each spanning the full viewport
 * (`spec/geometry-module.md:272`: "Grid lines are parallel to the canvas axes and pass through
 * every multiple of the spacing").
 */
function paintGridOverlay(
  target: RenderTarget,
  grid: GridOverlay,
  viewport: Viewport,
): void {
  const scale = viewport.scale ?? DEFAULT_SCALE;
  const centerX = viewport.width / 2;
  const centerY = viewport.height / 2;
  target.strokeStyle = GRID_STROKE_STYLE;
  target.lineWidth = GRID_LINE_WIDTH * scale;

  for (const worldX of multiplesInRange(
    grid.spacing,
    -centerX / scale,
    centerX / scale,
  )) {
    const [targetX] = worldToTarget([worldX, 0], viewport);
    target.beginPath();
    target.moveTo(targetX, 0);
    target.lineTo(targetX, viewport.height);
    target.stroke();
  }
  for (const worldY of multiplesInRange(
    grid.spacing,
    -centerY / scale,
    centerY / scale,
  )) {
    const [, targetY] = worldToTarget([0, worldY], viewport);
    target.beginPath();
    target.moveTo(0, targetY);
    target.lineTo(viewport.width, targetY);
    target.stroke();
  }
}

/**
 * Draws the axes overlay: the horizontal line `y == 0` and the vertical line `x == 0`, crossing
 * at `home` (`spec/geometry-module.md:286`), each spanning the full viewport.
 */
function paintAxesOverlay(target: RenderTarget, viewport: Viewport): void {
  const [originX, originY] = worldToTarget([0, 0], viewport);
  target.strokeStyle = AXES_STROKE_STYLE;
  target.lineWidth = AXES_LINE_WIDTH;
  target.beginPath();
  target.moveTo(0, originY);
  target.lineTo(viewport.width, originY);
  target.stroke();
  target.beginPath();
  target.moveTo(originX, 0);
  target.lineTo(originX, viewport.height);
  target.stroke();
}

/**
 * Draws the `measure` overlay's marker: a small filled dot at the last-measured position plus a
 * short tick pointing along the last-measured heading — an educational annotation, not turtle
 * drawing (`spec/geometry-module.md:298-300`).
 */
function paintMeasureOverlay(
  target: RenderTarget,
  position: Point,
  heading: number,
  viewport: Viewport,
): void {
  const [screenX, screenY] = worldToTarget(position, viewport);
  target.fillStyle = MEASURE_STROKE_STYLE;
  target.beginPath();
  target.arc(screenX, screenY, MEASURE_MARKER_RADIUS, 0, 2 * Math.PI);
  target.fill();

  const radians = heading * DEGREES_TO_RADIANS;
  const tickLength = MEASURE_MARKER_RADIUS * 3;
  const tickX = screenX + Math.sin(radians) * tickLength;
  const tickY = screenY - Math.cos(radians) * tickLength;
  target.strokeStyle = MEASURE_STROKE_STYLE;
  target.lineWidth = 1;
  target.beginPath();
  target.moveTo(screenX, screenY);
  target.lineTo(tickX, tickY);
  target.stroke();
}

/**
 * Draws every enabled overlay (`grid`/`axes`/`measure`) on top of the retained scene, in that
 * fixed order, matching the Geometry profile's overlays (`spec/rendering.md:129-139`). A `save`/
 * `restore` bracket isolates the overlay draw calls' `strokeStyle`/`fillStyle`/`lineWidth` from
 * whatever the caller sets afterwards (mirroring {@link paintAvatar}'s isolation).
 */
export function paintOverlay(
  target: RenderTarget,
  overlay: OverlayState,
  viewport: Viewport,
): void {
  target.save();
  if (overlay.grid !== undefined) {
    paintGridOverlay(target, overlay.grid, viewport);
  }
  if (overlay.axes) {
    paintAxesOverlay(target, viewport);
  }
  if (overlay.measure !== undefined) {
    paintMeasureOverlay(
      target,
      overlay.measure.position,
      overlay.measure.heading,
      viewport,
    );
  }
  target.restore();
}

/**
 * Repaints the target from the retained scene alone: background, then each drawing item in
 * execution order (a `draw-segment` strokes a line with the color/width captured in that
 * segment; a `fill` fills the enclosed path formed by the immediately preceding contiguous
 * segments; a `stamp` paints a fixed avatar at its own recorded position/heading/shape/color),
 * then any enabled overlays ({@link paintOverlay}; `overlay` defaults to none, painting nothing).
 * Never re-runs the program and never reads live turtle state — that is {@link paintTurtle}'s
 * job, layered on top.
 */
export function paintScene(
  target: RenderTarget,
  scene: TurtleScene,
  viewport: Viewport,
  overlay?: OverlayState,
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

  if (overlay !== undefined) {
    paintOverlay(target, overlay, viewport);
  }
}

/**
 * Repaints the whole target: the retained scene (background + drawing items), then any enabled
 * overlays, then the live turtle avatar on top — but only when `state.visible`
 * (`spec/rendering.md`: "A hidden turtle still moves, turns, draws when the pen is down, and
 * reports its state normally" — hiding it only omits the avatar, never the scene or overlays).
 * `overlay` defaults to omitted (no overlays painted) for callers that have not yet reduced
 * overlay state. This is the renderer's one public entry point for a full repaint; production
 * code calls it with a real Canvas 2D context, tests with a recording fake, both satisfying
 * {@link RenderTarget} structurally.
 */
export function paintTurtle(
  target: RenderTarget,
  scene: TurtleScene,
  state: TurtleState,
  viewport: Viewport,
  overlay?: OverlayState,
): void {
  paintScene(target, scene, viewport, overlay);
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

/**
 * A minimal source of the current frame to paint — anything that can produce an
 * {@link AnimationSnapshot}. Kept as a structural subset (not the concrete
 * `TurtleAnimationController` type) so a test double needs only this one member, matching the
 * same dependency-injection style as {@link RenderTarget}.
 */
export interface ReducedMotionSource {
  getSnapshot(): AnimationSnapshot;
}

/**
 * The subset of {@link TurtleAnimationController} that {@link playWithMotionPreference} drives
 * to START (or resume) playback: paced (`run`) or instant (`seekToEnd`). Kept structural for the
 * same reason as {@link ReducedMotionSource} — a test double needs only these two members.
 */
export interface MotionPreferencePlayer {
  run(): void;
  seekToEnd(): void;
}

/**
 * A caller-supplied motion preference, e.g. read from the platform's `prefers-reduced-motion`
 * setting. Detecting that OS/browser preference is a DOM concern owned by the host UI (Studio);
 * this package only reacts to the boolean it is given, keeping `@openlogo/turtle` headless and
 * DOM-free (`spec/rendering.md#reduced-motion`).
 */
export interface MotionPreference {
  /** When `true`, {@link playWithMotionPreference} starts playback instantly instead of paced. */
  readonly reducedMotion: boolean;
}

/**
 * Paints one frame from an animation source: exactly the source's CURRENT snapshot, unmodified.
 * Rendering never advances, drains, or otherwise mutates the source's cursor — it only reads
 * whatever has already been consumed — so painting a paused, idle, or mid-run frame can never
 * change playback status or skip ahead. Painting always goes through {@link paintTurtle} from
 * the retained scene alone (never re-running the program).
 */
export function renderFrame(
  target: RenderTarget,
  source: ReducedMotionSource,
  viewport: Viewport,
): void {
  const { state, scene, overlay } = source.getSnapshot();
  paintTurtle(target, scene, state, viewport, overlay);
}

/**
 * Starts (or resumes) playback on `player`, honoring a reduced-motion preference
 * (`spec/rendering.md#reduced-motion`): "In reduced-motion mode, the renderer MUST avoid
 * continuous animated movement by default. It SHOULD present instant drawing … Step and pause
 * controls MUST remain available."
 *
 * - `reducedMotion: true` — drains the WHOLE remaining event stream instantly
 *   ({@link MotionPreferencePlayer.seekToEnd}) instead of pacing continuous per-step ticks.
 * - `reducedMotion: false` — starts the player's own paced tick loop ({@link
 *   MotionPreferencePlayer.run}).
 *
 * This is the ONLY place a motion preference has any effect — it is a decision about how a
 * caller-initiated "start playback" action behaves, never something {@link renderFrame} or any
 * other paint call performs implicitly. In particular this function is never invoked merely to
 * repaint an already-paused or already-idle controller: the caller decides when playback starts,
 * and `step()`/`pause()` on the same controller remain entirely independent controls, unaffected
 * by (and available before, during, and after) a reduced-motion run — a learner can still step
 * through or pause partway even though the run itself proceeds instantly. Either branch still
 * folds the identical event stream through the identical reducers, so reduced motion changes only
 * how eagerly playback proceeds, never the event stream, final scene, turtle state, or export
 * output — the determinism invariant `spec/rendering.md#reduced-motion` requires ("Reduced-motion
 * mode MUST NOT change the event stream, final scene, turtle state, or export output").
 */
export function playWithMotionPreference(
  player: MotionPreferencePlayer,
  preference: MotionPreference,
): void {
  if (preference.reducedMotion) {
    player.seekToEnd();
  } else {
    player.run();
  }
}
