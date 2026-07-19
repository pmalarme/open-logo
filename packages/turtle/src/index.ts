/**
 * `@openlogo/turtle` — turtle/sprite state, pen/heading/shape, rendering (Canvas/SVG/PNG),
 * animation, deterministic export, and accessibility. Consumes the trace/event stream from
 * `@openlogo/core`.
 *
 * ```ts
 * import * as OL from "@openlogo/turtle";
 * const state = OL.reduceTurtleEvents(events);
 * const scene = OL.reduceSceneEvents(events);
 * OL.paintTurtle(canvasContext, scene, state, { width: 400, height: 400 });
 * const svg = OL.exportTurtleSvg(scene, state, { width: 400, height: 400 });
 * ```
 *
 * This slice publishes the deterministic turtle-**state** reducer (position, heading, pen,
 * color, width, shape, visibility), the deterministic retained-**scene** reducer (background,
 * segments, fills, stamps), the **Canvas live renderer**, and the **deterministic SVG export**
 * — both renderers paint the same retained data through the same dependency-injected
 * `RenderTarget` abstraction and coordinate mapping. PNG export lands in a later slice.
 */

export {
  INITIAL_TURTLE_STATE,
  reduceTurtleEvents,
  reduceTurtleState,
} from "./state.js";
export type { TurtleState } from "./state.js";

export {
  INITIAL_TURTLE_SCENE,
  reduceSceneEvents,
  reduceTurtleScene,
} from "./scene.js";
export type {
  SceneFill,
  SceneItem,
  SceneSegment,
  SceneStamp,
  TurtleScene,
} from "./scene.js";

export { paintScene, paintTurtle, worldToTarget } from "./canvas.js";
export type { RenderTarget, Viewport } from "./canvas.js";

export { exportTurtleSvg } from "./svg.js";
export type { SvgExportOptions } from "./svg.js";
