/**
 * The turtle Canvas view (#218) — composes `@openlogo/turtle`'s DOM-free renderer into the app
 * shell's `turtle` region. This slice is **static composition only**: it paints whatever
 * `turtleState`/`turtleScene` currently sit in the shared #123 state model (the program-start
 * defaults, until #228 wires the run loop to keep them live after each run) — it never re-runs a
 * program, folds trace events, or duplicates `@openlogo/turtle`'s reducers/coordinate math
 * itself.
 *
 * ## DOM ownership boundary
 * `@openlogo/turtle` is deliberately DOM-free: its `RenderTarget` is a minimal structural subset
 * of the real Canvas 2D drawing API (`fillStyle`/`strokeStyle`/`lineWidth` plus the handful of
 * draw calls `paintScene`/`paintTurtle` need), not `CanvasRenderingContext2D` itself — this
 * monorepo has no `lib.dom` and no `node-canvas` dependency anywhere
 * (`tsconfig.base.json`'s `lib` is `["es2023"]` only). Studio owns the real DOM/browser canvas:
 * {@link Canvas2DContext} names the subset of a real 2-D context's surface this adapter needs,
 * and {@link createCanvasRenderTarget} is the seam where a real `<canvas>`'s `getContext("2d")`
 * result is handed to `@openlogo/turtle`'s headless painter — the DOM canvas lives here, never
 * inside `@openlogo/turtle`. A real `CanvasRenderingContext2D` is **not** directly usable as a
 * `RenderTarget` (its `fillStyle`/`strokeStyle` accept `CanvasGradient`/`CanvasPattern` in
 * addition to `string`, a wider type than `RenderTarget` declares — exactly the narrowing gap
 * `@openlogo/turtle`'s own doc comment calls out), so {@link createCanvasRenderTarget} is a real
 * forwarding wrapper, not a pass-through: it reads/writes `fillStyle`/`strokeStyle` as strings
 * only (the only values this renderer ever assigns) and delegates every draw call to the
 * underlying context. A `node:test` fake implementing {@link Canvas2DContext} exercises the
 * exact same path with no DOM at all.
 */

import type {
  RenderTarget,
  TurtleScene,
  TurtleState,
  Viewport,
} from "@openlogo/turtle";
import { paintTurtle } from "@openlogo/turtle";
import type { AppShell } from "./app-shell.js";
import type { StudioStateStore } from "./state-model.js";

/**
 * The structural shape of a real Canvas 2D drawing context {@link createCanvasRenderTarget}
 * accepts. Declared locally rather than reused from `lib.dom` (which this package's `tsconfig`
 * does not include). `fillStyle`/`strokeStyle` are typed as `unknown` here — not `string` — so a
 * real `CanvasRenderingContext2D` (whose `fillStyle`/`strokeStyle` accept
 * `CanvasGradient`/`CanvasPattern` too) is structurally assignable to this parameter type without
 * a cast at the call site; `canvas-view.test.mjs` passes a small recording fake with no DOM at
 * all.
 */
export interface Canvas2DContext {
  fillStyle: unknown;
  strokeStyle: unknown;
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
 * Adapts a real (or real-shaped) Canvas 2D context into `@openlogo/turtle`'s headless
 * {@link RenderTarget}. This is a genuine forwarding wrapper, not a pass-through: `fillStyle`/
 * `strokeStyle` are read back as `string` (this renderer only ever assigns plain color strings
 * through them, per `paintScene`'s doc comment) and every draw call delegates to `context`. This
 * is the one named seam where studio's DOM-owning code hands a real canvas 2D context to
 * `@openlogo/turtle`'s DOM-free renderer (`studio.instructions.md`: "Studio owns the DOM side").
 */
export function createCanvasRenderTarget(
  context: Canvas2DContext,
): RenderTarget {
  return {
    get fillStyle(): string {
      return context.fillStyle as string;
    },
    set fillStyle(value: string) {
      context.fillStyle = value;
    },
    get strokeStyle(): string {
      return context.strokeStyle as string;
    },
    set strokeStyle(value: string) {
      context.strokeStyle = value;
    },
    get lineWidth(): number {
      return context.lineWidth;
    },
    set lineWidth(value: number) {
      context.lineWidth = value;
    },
    save: () => context.save(),
    restore: () => context.restore(),
    translate: (x, y) => context.translate(x, y),
    rotate: (angleRadians) => context.rotate(angleRadians),
    beginPath: () => context.beginPath(),
    closePath: () => context.closePath(),
    moveTo: (x, y) => context.moveTo(x, y),
    lineTo: (x, y) => context.lineTo(x, y),
    stroke: () => context.stroke(),
    fill: () => context.fill(),
    fillRect: (x, y, width, height) => context.fillRect(x, y, width, height),
    arc: (x, y, radius, startAngle, endAngle) =>
      context.arc(x, y, radius, startAngle, endAngle),
  };
}

/** Options for {@link createCanvasViewController}. */
export interface CanvasViewOptions {
  /** The real (or fake, for tests) 2-D drawing context to paint into. */
  readonly target: Canvas2DContext;
  /** The target's pixel size and world-to-target scale (`@openlogo/turtle`'s `Viewport`). */
  readonly viewport: Viewport;
}

/** The headless Canvas view controller. Paints the shared state model's turtle state/scene. */
export interface CanvasViewController {
  /** The viewport this controller currently paints at (updated by {@link setViewport}). */
  readonly viewport: Viewport;
  /** Repaint the target from the state model's current `turtleState`/`turtleScene`. */
  repaint(): void;
  /**
   * Adopt a new {@link Viewport} — the DPR-aware backing size + scale studio recomputes when the
   * canvas is resized or the display's `devicePixelRatio` changes (#474). The next {@link repaint}
   * paints through it. Only the raster resolution changes: `@openlogo/turtle`'s `worldToTarget`
   * maps every world coordinate to the same *normalized* target position at any viewport
   * (`resolveBackingResolution`), so turtle positions, headings, and segment endpoints never drift.
   */
  setViewport(viewport: Viewport): void;
}

/**
 * Construct the Canvas view controller bound to the shared studio state model. `repaint()` reads
 * `state.getState().turtleState`/`.turtleScene` — the same `@openlogo/turtle` types the state
 * model stores verbatim — and paints them through `@openlogo/turtle`'s `paintTurtle`, never
 * re-deriving turtle coordinates, colors, or scene items itself.
 */
export function createCanvasViewController(
  state: StudioStateStore,
  options: CanvasViewOptions,
): CanvasViewController {
  const renderTarget = createCanvasRenderTarget(options.target);
  let viewport = options.viewport;

  function paint(turtleState: TurtleState, turtleScene: TurtleScene): void {
    paintTurtle(renderTarget, turtleScene, turtleState, viewport);
  }

  return {
    get viewport(): Viewport {
      return viewport;
    },
    setViewport(next: Viewport): void {
      viewport = next;
    },
    repaint() {
      const { turtleState, turtleScene } = state.getState();
      paint(turtleState, turtleScene);
    },
  };
}

/**
 * Compose the Canvas view controller into the app shell's `turtle` region and paint the current
 * (program-start default, until #228 wires the run loop) turtle state/scene immediately, so the
 * pane never shows a stale or blank target the moment it mounts.
 */
export function mountCanvasView(
  shell: AppShell,
  controller: CanvasViewController,
): void {
  shell.mount("turtle", controller);
  controller.repaint();
}
