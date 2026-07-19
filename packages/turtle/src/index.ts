/**
 * `@openlogo/turtle` — turtle/sprite state, pen/heading/shape, rendering (Canvas/SVG/PNG),
 * animation, deterministic export, and accessibility. Consumes the trace/event stream from
 * `@openlogo/core`.
 *
 * ```ts
 * import * as OL from "@openlogo/turtle";
 * const state = OL.reduceTurtleEvents(events);
 * const scene = OL.reduceSceneEvents(events);
 * ```
 *
 * This slice publishes the deterministic turtle-**state** reducer (position, heading, pen,
 * color, width, shape, visibility) and the deterministic retained-**scene** reducer
 * (background, segments, fills, stamps). Renderers land in later slices.
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
