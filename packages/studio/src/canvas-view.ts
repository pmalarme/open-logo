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
 * {@link Canvas2DContextLike} names exactly the subset of a real 2-D context's surface this
 * adapter forwards (mirroring `RenderTarget` field-for-field), and
 * {@link createCanvasRenderTarget} is the seam where a real `<canvas>`'s `getContext("2d")`
 * result is handed to `@openlogo/turtle`'s headless painter — the DOM canvas lives here, never
 * inside `@openlogo/turtle`. A `node:test` fake implementing {@link Canvas2DContextLike}
 * exercises the exact same path with no DOM at all.
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
 * The structural subset of a real Canvas 2D drawing context this adapter forwards to
 * `@openlogo/turtle`'s {@link RenderTarget}. Declared locally rather than reused from `lib.dom`
 * (which this package's `tsconfig` does not include) — a real browser
 * `CanvasRenderingContext2D` satisfies this shape structurally (it has every member below), so
 * production code can pass one directly; `canvas-view.test.mjs` passes a small recording fake
 * with no DOM at all.
 */
export interface Canvas2DContextLike {
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
 * Adapts a real (or real-shaped) Canvas 2D context into `@openlogo/turtle`'s headless
 * {@link RenderTarget}. `Canvas2DContextLike` and `RenderTarget` are structurally identical by
 * design, so this is a pass-through — its purpose is to be the one named seam where studio's
 * DOM-owning code hands a real canvas 2D context to `@openlogo/turtle`'s DOM-free renderer
 * (`studio.instructions.md`: "Studio owns the DOM side").
 */
export function createCanvasRenderTarget(
  context: Canvas2DContextLike,
): RenderTarget {
  return context;
}

/** Options for {@link createCanvasViewController}. */
export interface CanvasViewOptions {
  /** The real (or fake, for tests) 2-D drawing context to paint into. */
  readonly target: Canvas2DContextLike;
  /** The target's pixel size and world-to-target scale (`@openlogo/turtle`'s `Viewport`). */
  readonly viewport: Viewport;
}

/** The headless Canvas view controller. Paints the shared state model's turtle state/scene. */
export interface CanvasViewController {
  /** The viewport this controller paints at. */
  readonly viewport: Viewport;
  /** Repaint the target from the state model's current `turtleState`/`turtleScene`. */
  repaint(): void;
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

  function paint(turtleState: TurtleState, turtleScene: TurtleScene): void {
    paintTurtle(renderTarget, turtleScene, turtleState, options.viewport);
  }

  return {
    viewport: options.viewport,
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
